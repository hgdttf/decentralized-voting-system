import dotenv from "dotenv";

import { readFileSync } from "node:fs";
import { join } from "node:path";

dotenv.config({
    path: join(process.cwd(), "backend", ".env")
});

import {
    Identity,
    generateProof
} from "@semaphore-protocol/core";

import { ethers, network } from "hardhat";
import { keccak256 } from "ethers";

import {
    decryptIdentityBackup,
    EncryptedIdentityBackup
} from "./identity-vault";

import {
    decryptElectionKeyBackup,
    EncryptedElectionKeyBackup
} from "./election-key-vault";

import {
    encryptBallot,
    decryptBallot
} from "./ballot-crypto";

import {
    reconstructSemaphoreGroup
} from "./semaphore-group";

async function main(): Promise<void> {
    const electionId = 5n;
    const electionIdText = "5";

    const identityPassphrase =
        process.env.IDENTITY_VAULT_PASSPHRASE;

    const electionKeyPassphrase =
        process.env.ELECTION_KEY_PASSPHRASE;

    if (!identityPassphrase || !electionKeyPassphrase) {
        throw new Error("Required vault passphrases are not configured.");
    }

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
        throw new Error("Unexpected deployment configuration.");
    }

    const networkInfo = await ethers.provider.getNetwork();

    if (networkInfo.chainId !== 1337n) {
        throw new Error("Connected network is not Hardhat localhost.");
    }

    const votingAddress = deployment.contracts?.voting;
    const semaphoreAddress = deployment.contracts?.semaphore;

    if (!votingAddress || !semaphoreAddress) {
        throw new Error("Deployment addresses are missing.");
    }

    const voting = await ethers.getContractAt(
        "Voting",
        votingAddress
    );

    const election = await voting.getElection(electionId);

    if (Number(election.status) !== 0) {
        throw new Error(
            `Expected Registration status (0); found ${election.status}.`
        );
    }

    const block = await ethers.provider.getBlock("latest");

    if (!block) {
        throw new Error("Unable to read latest block.");
    }

    if (BigInt(block.timestamp) >= BigInt(election.startTime)) {
        throw new Error("Election start time has arrived. Dry run aborted.");
    }

    const candidates = Array.from(
        await voting.getCandidates(electionId),
        (candidate: { name: string }) => candidate.name
    );

    if (candidates.length !== 2) {
        throw new Error("Unexpected Election 5 candidate count.");
    }

    const onChainPublicKey =
        String(await voting.getElectionPublicKey(electionId));

    if (!/^0x[0-9a-f]{64}$/i.test(onChainPublicKey)) {
        throw new Error("Election public key is missing or invalid.");
    }

    const keyBackupPath = join(
        process.cwd(),
        "backups",
        "election-5.election-key.json"
    );

    const keyBackup = JSON.parse(
        readFileSync(keyBackupPath, "utf8")
    ) as EncryptedElectionKeyBackup;

    const electionKeys = await decryptElectionKeyBackup(
        keyBackup,
        electionIdText,
        electionKeyPassphrase
    );

    if (
        `0x${electionKeys.publicKey}`.toLowerCase() !==
        onChainPublicKey.toLowerCase()
    ) {
        throw new Error("Election key backup does not match on-chain key.");
    }

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
        throw new Error("Semaphore membership count mismatch.");
    }

    if (reconstructed.memberCount !== 3) {
        throw new Error("Expected exactly three registered voters.");
    }

    console.log("\nELECTION 5 OFFLINE VALIDATION");
    console.log("--------------------------------");
    console.log("Network:", network.name);
    console.log("Chain ID:", networkInfo.chainId.toString());
    console.log("Election status: Registration");
    console.log("Election start time:", election.startTime.toString());
    console.log("Candidates:", candidates.length);
    console.log("Semaphore group:", election.groupId.toString());
    console.log("Registered members:", reconstructed.memberCount);
    console.log("Election public key: verified");
    console.log("Election key backup: decrypted and verified");
    console.log("--------------------------------");

    for (let index = 1; index <= 3; index++) {
        const label = `voter-${String(index).padStart(3, "0")}`;

        const backupPath = join(
            process.cwd(),
            "backups",
            `election-${electionIdText}-${label}-identity.json`
        );

        const backup = JSON.parse(
            readFileSync(backupPath, "utf8")
        ) as EncryptedIdentityBackup;

        const identity: Identity = await decryptIdentityBackup(
            backup,
            identityPassphrase
        );

        const registered = await voting.registeredCommitments(
            electionId,
            identity.commitment
        );

        if (!registered) {
            throw new Error(`${label}: commitment is not registered.`);
        }

        const candidate = candidates[(index - 1) % candidates.length];

        const ciphertextHex = await encryptBallot(
            candidate,
            electionKeys.publicKey
        );

        const ciphertext = `0x${ciphertextHex}`;

        const message = BigInt(keccak256(ciphertext));

        const proof = await generateProof(
            identity,
            reconstructed.group,
            message,
            BigInt(election.scope)
        );

        if (proof.points.length !== 8) {
            throw new Error(`${label}: invalid Semaphore proof length.`);
        }

        if (
            BigInt(proof.message) !== message ||
            BigInt(proof.scope) !== BigInt(election.scope) ||
            BigInt(proof.merkleTreeRoot) !== reconstructed.root
        ) {
            throw new Error(`${label}: proof consistency check failed.`);
        }

        const decrypted = await decryptBallot(
            ciphertextHex,
            electionKeys.publicKey,
            electionKeys.privateKey
        );

        if (decrypted !== candidate) {
            throw new Error(`${label}: encryption round-trip failed.`);
        }

        console.log(
            `${label}: identity restored, registration verified, ` +
            "proof generated, ciphertext verified."
        );
    }

    console.log("--------------------------------");
    console.log("OFFLINE VALIDATION PASSED");
    console.log("No ballots submitted.");
    console.log("No blockchain state changed.");
}

main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : "Unknown error.";

    console.error("OFFLINE VALIDATION FAILED:", message);
    process.exitCode = 1;
});
