
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    Identity,
    generateProof
} from "@semaphore-protocol/core";

import { keccak256 } from "ethers";
import { ethers } from "hardhat";

import {
    decryptIdentityBackup,
    EncryptedIdentityBackup
} from "./identity-vault";

import { encryptBallot } from "./ballot-crypto";
import { reconstructSemaphoreGroup } from "./semaphore-group";

async function main(): Promise<void> {
    // --------------------------------------------------
    // 1. Read and validate configuration
    // --------------------------------------------------

    const electionIdText = process.env.ELECTION_ID ?? "3";
    const voterLabel = process.env.VOTER_LABEL;
    const candidateName = process.env.CANDIDATE_NAME;
    const identityPassphrase = process.env.IDENTITY_VAULT_PASSPHRASE;

    if (!/^[1-9]\d*$/.test(electionIdText)) {
        throw new Error("ELECTION_ID must be a positive integer.");
    }

    if (!voterLabel || !/^voter-\d{3}$/.test(voterLabel)) {
        throw new Error(
            "Set VOTER_LABEL to an existing identity label, e.g. voter-001."
        );
    }

    if (!candidateName || candidateName.trim().length === 0) {
        throw new Error("CANDIDATE_NAME must not be empty.");
    }

    if (!identityPassphrase) {
        throw new Error("IDENTITY_VAULT_PASSPHRASE must be set.");
    }

    const electionId = BigInt(electionIdText);

    // --------------------------------------------------
    // 2. Verify deployment configuration
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
        String(deployment.chainId) !== "1337"
    ) {
        throw new Error("Unexpected deployment network.");
    }

    const votingAddress = deployment.contracts?.voting;
    const semaphoreAddress = deployment.contracts?.semaphore;

    if (!votingAddress || !semaphoreAddress) {
        throw new Error(
            "Voting or Semaphore deployment address is missing."
        );
    }

    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        throw new Error(
            `Unexpected connected chain ID: ${network.chainId}`
        );
    }

    const [signer] = await ethers.getSigners();

    if (!signer) {
        throw new Error("No transaction signer is available.");
    }

    const voting = await ethers.getContractAt(
        "Voting",
        votingAddress,
        signer
    );

    console.log("Election:", electionIdText);
    console.log("Network: localhost");
    console.log("Chain ID:", network.chainId.toString());

    // --------------------------------------------------
    // 3. Verify election state and voting time
    // --------------------------------------------------

    const election = await voting.getElection(electionId);

    if (Number(election.status) !== 1) {
        throw new Error(
            `Election is not in Voting status. Current status: ${election.status}`
        );
    }

    const latestBlock = await ethers.provider.getBlock("latest");

    if (!latestBlock) {
        throw new Error("Unable to read the latest blockchain block.");
    }

    const chainTimestamp = BigInt(latestBlock.timestamp);

    if (chainTimestamp < BigInt(election.startTime)) {
        throw new Error("Election voting period has not started.");
    }

    if (chainTimestamp >= BigInt(election.endTime)) {
        throw new Error("Election voting deadline has passed.");
    }

    // --------------------------------------------------
    // 4. Restore the registered voter identity
    // --------------------------------------------------

    const identityBackupPath = join(
        process.cwd(),
        "backups",
        `election-${electionIdText}-${voterLabel}-identity.json`
    );

    const identityBackup = JSON.parse(
        readFileSync(identityBackupPath, "utf8")
    ) as EncryptedIdentityBackup;

    const identity: Identity = await decryptIdentityBackup(
        identityBackup,
        identityPassphrase
    );

    const isRegistered = await voting.registeredCommitments(
        electionId,
        identity.commitment
    );

    if (!isRegistered) {
        throw new Error(
            "This identity commitment is not registered for this election."
        );
    }

    // --------------------------------------------------
    // 5. Reconstruct and verify the Semaphore group
    // --------------------------------------------------

    const reconstructed = await reconstructSemaphoreGroup(
        ethers.provider,
        semaphoreAddress,
        BigInt(election.groupId),
        0
    );

    if (
        reconstructed.memberCount !==
        Number(election.registeredVoterCount)
    ) {
        throw new Error(
            "Reconstructed Semaphore membership count does not match " +
            "the election registration count."
        );
    }

    console.log(
        "Semaphore membership verified:",
        reconstructed.memberCount,
        "registered identities"
    );

    // --------------------------------------------------
    // 6. Retrieve the public encryption key
    // --------------------------------------------------

    // Ballot submission requires only the public key.
    // The election private key is reserved for tallying.

    const onChainPublicKey: string =
        await voting.getElectionPublicKey(electionId);

    if (
        typeof onChainPublicKey !== "string" ||
        !/^0x[0-9a-f]{64}$/i.test(onChainPublicKey)
    ) {
        throw new Error(
            "Election encryption public key is missing or invalid."
        );
    }

    const electionPublicKey = onChainPublicKey.slice(2);

    // --------------------------------------------------
    // 7. Validate the candidate
    // --------------------------------------------------

    const candidates = await voting.getCandidates(electionId);

    const selectedCandidate = candidates.find(
        (candidate: { name: string }) =>
            candidate.name === candidateName
    );

    if (!selectedCandidate) {
        throw new Error(
            "CANDIDATE_NAME does not match an election candidate."
        );
    }

    // --------------------------------------------------
    // 8. Encrypt the ballot and bind the proof to it
    // --------------------------------------------------

    const ciphertextHex = await encryptBallot(
        selectedCandidate.name,
        electionPublicKey
    );

    const encryptedBallot = ciphertextHex.startsWith("0x")
        ? ciphertextHex
        : `0x${ciphertextHex}`;

    if (!/^0x(?:[0-9a-f]{2})+$/i.test(encryptedBallot)) {
        throw new Error("Ballot encryption returned invalid ciphertext.");
    }

    const message = BigInt(keccak256(encryptedBallot));

    // --------------------------------------------------
    // 9. Generate the Semaphore zero-knowledge proof
    // --------------------------------------------------

    const proof = await generateProof(
        identity,
        reconstructed.group,
        message,
        BigInt(election.scope)
    );

    if (proof.points.length !== 8) {
        throw new Error(
            "Semaphore proof contains an invalid number of proof points."
        );
    }

    const proofStruct = {
        merkleTreeDepth: proof.merkleTreeDepth,
        merkleTreeRoot: proof.merkleTreeRoot,
        nullifier: proof.nullifier,
        message: proof.message,
        scope: proof.scope,
        points: proof.points
    };

    // --------------------------------------------------
    // 10. Submit the encrypted ballot
    // --------------------------------------------------

    const acceptedBefore = BigInt(election.acceptedBallotCount);

    console.log("Submitting encrypted ballot...");

    const transaction = await voting.submitBallot(
        electionId,
        encryptedBallot,
        proofStruct
    );

    console.log("Transaction submitted:", transaction.hash);

    const receipt = await transaction.wait();

    if (!receipt || receipt.status !== 1) {
        throw new Error("Ballot submission transaction failed.");
    }

    // --------------------------------------------------
    // 11. Verify on-chain acceptance
    // --------------------------------------------------

    const updatedElection = await voting.getElection(electionId);

    const acceptedAfter = BigInt(
        updatedElection.acceptedBallotCount
    );

    if (acceptedAfter !== acceptedBefore + 1n) {
        throw new Error(
            "Transaction succeeded, but the accepted ballot counter " +
            "did not increase as expected. Verify the on-chain state."
        );
    }

    console.log("----------------------------------------");
    console.log("BALLOT SUBMISSION SUCCESSFUL");
    console.log("----------------------------------------");
    console.log("Transaction:", receipt.hash);
    console.log("Block:", receipt.blockNumber);
    console.log("Accepted ballots:", acceptedAfter.toString());
    console.log("----------------------------------------");
}

main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : String(error);

    console.error("Ballot submission failed:", message);
    process.exitCode = 1;
});
