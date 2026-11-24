import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ethers } from "hardhat";

import {
    decryptBallot
} from "./ballot-crypto";

import {
    decryptElectionKeyBackup,
    EncryptedElectionKeyBackup
} from "./election-key-vault";

async function main(): Promise<void> {
    const electionIdText = process.env.ELECTION_ID ?? "3";
    const electionKeyPassphrase =
        process.env.ELECTION_KEY_PASSPHRASE;

    if (!/^[1-9]\d*$/.test(electionIdText)) {
        throw new Error("ELECTION_ID must be a positive integer.");
    }

    if (!electionKeyPassphrase) {
        throw new Error(
            "ELECTION_KEY_PASSPHRASE must be set."
        );
    }

    const electionId = BigInt(electionIdText);

    // --------------------------------------------------
    // 1. Verify deployment configuration
    // --------------------------------------------------

    const deploymentPath = join(
        process.cwd(),
        "deployments",
        "localhost.json"
    );

    const deployment = JSON.parse(
        readFileSync(deploymentPath, "utf8")
    );

    if (
        deployment.network !== "localhost" ||
        deployment.chainId !== "1337"
    ) {
        throw new Error("Unexpected deployment network.");
    }

    const votingAddress = deployment.contracts?.voting;

    if (!votingAddress) {
        throw new Error("Voting contract address is missing.");
    }

    const [signer] = await ethers.getSigners();

    if (!signer) {
        throw new Error("No transaction signer is available.");
    }

    const signerAddress = await signer.getAddress();

    const voting = await ethers.getContractAt(
        "Voting",
        votingAddress,
        signer
    );

    console.log("Election:", electionIdText);
    console.log("Network:", deployment.network);
    console.log("Chain ID:", deployment.chainId);
    console.log("Transaction signer:", signerAddress);

    // --------------------------------------------------
    // 2. Verify election is closed and signer is admin
    // --------------------------------------------------

    const election = await voting.getElection(electionId);

    if (Number(election.status) !== 2) {
        throw new Error(
            `Election must be Closed (status 2). ` +
            `Current status: ${election.status}`
        );
    }

    if (
        String(election.admin).toLowerCase() !==
        signerAddress.toLowerCase()
    ) {
        throw new Error(
            "Connected signer is not the election administrator."
        );
    }

    const acceptedBallotCount =
        BigInt(election.acceptedBallotCount);

    if (acceptedBallotCount === 0n) {
        throw new Error("There are no accepted ballots to tally.");
    }

    console.log(
        "Accepted ballots recorded on-chain:",
        acceptedBallotCount.toString()
    );

    // --------------------------------------------------
    // 3. Restore election private key
    // --------------------------------------------------

    const backupPath = join(
        process.cwd(),
        "backups",
        `election-${electionIdText}.election-key.json`
    );

    const backup = JSON.parse(
        readFileSync(backupPath, "utf8")
    ) as EncryptedElectionKeyBackup;

    const electionKeys = await decryptElectionKeyBackup(
        backup,
        electionIdText,
        electionKeyPassphrase
    );

    const onChainPublicKey =
        await voting.getElectionPublicKey(electionId);

    if (
        String(onChainPublicKey).toLowerCase() !==
        `0x${electionKeys.publicKey}`.toLowerCase()
    ) {
        throw new Error(
            "Restored election key does not match the on-chain public key."
        );
    }

    console.log("Election decryption key verified against on-chain key.");

    // --------------------------------------------------
    // 4. Retrieve and validate candidates
    // --------------------------------------------------

    const candidates = await voting.getCandidates(electionId);

    const candidateNames = Array.from(
        candidates,
        (candidate: { name: string }) => candidate.name
    );

    if (candidateNames.length < 2) {
        throw new Error("Election candidate list is invalid.");
    }

    if (
        candidateNames.some(
            (name: string) =>
                typeof name !== "string" || name.length === 0
        )
    ) {
        throw new Error("Candidate list contains an invalid name.");
    }

    if (new Set(candidateNames).size !== candidateNames.length) {
        throw new Error("Candidate names must be unique for tallying.");
    }

    console.log("Candidate count:", candidateNames.length);

    // --------------------------------------------------
    // 5. Retrieve encrypted ballots
    // --------------------------------------------------

    const encryptedBallots = await voting.getEncryptedBallots(
        electionId
    );

    if (
        BigInt(encryptedBallots.length) !==
        acceptedBallotCount
    ) {
        throw new Error(
            "Encrypted ballot count does not match the " +
            "accepted ballot count recorded on-chain."
        );
    }

    console.log(
        "Encrypted ballots retrieved:",
        encryptedBallots.length
    );

    // --------------------------------------------------
    // 6. Decrypt and validate every ballot locally
    // --------------------------------------------------

    const tally = new Map<string, bigint>(
        candidateNames.map((name: string) => [name, 0n])
    );

    for (let i = 0; i < encryptedBallots.length; i++) {
        const storedCiphertext = String(encryptedBallots[i]);

        if (!/^0x(?:[0-9a-f]{2})+$/i.test(storedCiphertext)) {
            throw new Error(
                `Ballot ${i + 1} has an invalid on-chain encoding.`
            );
        }

        // Solidity bytes are 0x-prefixed.
        // decryptBallot expects unprefixed hexadecimal.
        const ciphertext = storedCiphertext.slice(2);

        let plaintext: string;

        try {
            plaintext = await decryptBallot(
                ciphertext,
                electionKeys.publicKey,
                electionKeys.privateKey
            );
        } catch {
            throw new Error(
                `Ballot ${i + 1} could not be decrypted. ` +
                "No tally has been finalized."
            );
        }

        // Exact candidate-name matching; no silent normalization.
        if (!tally.has(plaintext)) {
            throw new Error(
                `Ballot ${i + 1} contains an invalid candidate selection. ` +
                "No tally has been finalized."
            );
        }

        tally.set(
            plaintext,
            tally.get(plaintext)! + 1n
        );

        // Do not log or persist individual ballot plaintext.
    }

    // --------------------------------------------------
    // 7. Validate complete tally before finalization
    // --------------------------------------------------

    const voteCounts = candidateNames.map(
        (name: string) => tally.get(name)!
    );

    const calculatedTotal = voteCounts.reduce(
        (sum: bigint, count: bigint) => sum + count,
        0n
    );

    if (calculatedTotal !== acceptedBallotCount) {
        throw new Error(
            "Calculated tally does not equal accepted ballot count. " +
            "No tally has been finalized."
        );
    }

    console.log("All ballots decrypted and validated.");
    console.log(
        "Validated ballot total:",
        calculatedTotal.toString()
    );

    // --------------------------------------------------
    // 8. Finalize tally on-chain
    // --------------------------------------------------

    console.log("Submitting final tally transaction...");

    const tx = await voting.finalizeElection(
        electionId,
        voteCounts
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
        throw new Error("Tally finalization transaction failed.");
    }

    console.log("Finalization transaction:", receipt.hash);

    // --------------------------------------------------
    // 9. Verify finalized results on-chain
    // --------------------------------------------------

    const finalizedElection = await voting.getElection(electionId);

    if (Number(finalizedElection.status) !== 3) {
        throw new Error(
            "Transaction succeeded, but election is not Finalized."
        );
    }

    const onChainTotal = BigInt(
        finalizedElection.totalValidVotes
    );

    if (onChainTotal !== calculatedTotal) {
        throw new Error(
            "On-chain total does not match the validated tally."
        );
    }

    console.log("\n========== FINAL ELECTION RESULTS ==========");

    for (let i = 0; i < candidateNames.length; i++) {
        const candidateId = BigInt(i + 1);

        const onChainCount = BigInt(
            await voting.getCandidateVoteCount(
                electionId,
                candidateId
            )
        );

        if (onChainCount !== voteCounts[i]) {
            throw new Error(
                `On-chain count verification failed for candidate ${i + 1}.`
            );
        }

        console.log(
            `${candidateNames[i]}: ${onChainCount.toString()}`
        );
    }

    console.log("---------------------------------------------");
    console.log("Total valid votes:", onChainTotal.toString());
    console.log("Election status: Finalized (3)");
    console.log("Finalization verified on-chain.");
    console.log("=============================================");
}

main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : "Unknown error";

    console.error("\nTALLY FAILED:", message);
    process.exitCode = 1;
});
