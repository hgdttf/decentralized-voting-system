import dotenv from "dotenv";
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

dotenv.config({ path: join(process.cwd(), "backend", ".env") });

const ELECTION_ID = 5;
const API_BASE = "http://127.0.0.1:8000";
const VOTERS = [
    { label: "voter-001", candidate: "Candidate A" },
    { label: "voter-002", candidate: "Candidate B" },
    { label: "voter-003", candidate: "Candidate A" }
];

async function main(): Promise<void> {
    const passphrase = process.env.IDENTITY_VAULT_PASSPHRASE;

    if (!passphrase) {
        throw new Error("Identity vault passphrase is unavailable.");
    }

    const deployment = JSON.parse(
        readFileSync(
            join(process.cwd(), "deployments", "localhost.json"),
            "utf8"
        )
    );

    if (
        deployment.network !== "localhost" ||
        String(deployment.chainId) !== "1337"
    ) {
        throw new Error("Unexpected deployment network.");
    }

    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        throw new Error("Connected chain is not localhost 1337.");
    }

    const voting = await ethers.getContractAt(
        "Voting",
        deployment.contracts.voting
    );

    const election = await voting.getElection(ELECTION_ID);

    if (Number(election.status) !== 1) {
        throw new Error("Election 5 is not in Voting status.");
    }

    const latestBlock = await ethers.provider.getBlock("latest");

    if (
        !latestBlock ||
        BigInt(latestBlock.timestamp) < BigInt(election.startTime) ||
        BigInt(latestBlock.timestamp) >= BigInt(election.endTime)
    ) {
        throw new Error("Election 5 is outside its voting window.");
    }

    const initialCount = Number(election.acceptedBallotCount);

    if (initialCount !== 0) {
        throw new Error(
            `Expected zero ballots before this test; found ${initialCount}.`
        );
    }

    const candidates = await voting.getCandidates(ELECTION_ID);
    const candidateNames = candidates.map(
        (candidate: { name: string }) => candidate.name
    );

    for (const voter of VOTERS) {
        if (!candidateNames.includes(voter.candidate)) {
            throw new Error(
                `Unknown candidate configured for ${voter.label}.`
            );
        }
    }

    const publicKey: string =
        await voting.getElectionPublicKey(ELECTION_ID);

    if (!/^0x[0-9a-f]{64}$/i.test(publicKey)) {
        throw new Error("Election public key is invalid.");
    }

    const reconstructed = await reconstructSemaphoreGroup(
        ethers.provider,
        deployment.contracts.semaphore,
        BigInt(election.groupId),
        0
    );

    if (
        reconstructed.memberCount !==
        Number(election.registeredVoterCount)
    ) {
        throw new Error("Semaphore membership count mismatch.");
    }

    console.log("ELECTION 5 — FASTAPI BALLOT SUBMISSION");
    console.log("--------------------------------------");
    console.log("Election status: Voting");
    console.log("Registered identities:", reconstructed.memberCount);
    console.log("Existing accepted ballots:", initialCount);
    console.log("Submission route: FastAPI");
    console.log("--------------------------------------");

    for (let index = 0; index < VOTERS.length; index++) {
        const voter = VOTERS[index];

        const currentElection = await voting.getElection(ELECTION_ID);

        if (Number(currentElection.status) !== 1) {
            throw new Error("Election stopped accepting ballots.");
        }

        if (
            Number(currentElection.acceptedBallotCount) !== index
        ) {
            throw new Error(
                "Unexpected ballot count. Stopping to prevent duplicate submissions."
            );
        }

        const backupPath = join(
            process.cwd(),
            "backups",
            `election-${ELECTION_ID}-${voter.label}-identity.json`
        );

        const backup = JSON.parse(
            readFileSync(backupPath, "utf8")
        ) as EncryptedIdentityBackup;

        const identity: Identity = await decryptIdentityBackup(
            backup,
            passphrase
        );

        const registered = await voting.registeredCommitments(
            ELECTION_ID,
            identity.commitment
        );

        if (!registered) {
            throw new Error(`${voter.label} is not registered.`);
        }

        const ciphertext = await encryptBallot(
            voter.candidate,
            publicKey.slice(2)
        );

        const encryptedBallot = ciphertext.startsWith("0x")
            ? ciphertext
            : `0x${ciphertext}`;

        if (!/^0x(?:[0-9a-f]{2})+$/i.test(encryptedBallot)) {
            throw new Error("Invalid encrypted ballot.");
        }

        const message = BigInt(keccak256(encryptedBallot));

        const proof = await generateProof(
            identity,
            reconstructed.group,
            message,
            BigInt(election.scope)
        );

        if (
            proof.points.length !== 8 ||
            BigInt(proof.message) !== message ||
            BigInt(proof.scope) !== BigInt(election.scope) ||
            BigInt(proof.merkleTreeRoot) !== reconstructed.root
        ) {
            throw new Error(`${voter.label}: proof validation failed.`);
        }

        const payload = {
            encrypted_ballot: encryptedBallot,
            proof: {
                merkleTreeDepth: Number(proof.merkleTreeDepth),
                merkleTreeRoot: String(proof.merkleTreeRoot),
                nullifier: String(proof.nullifier),
                message: String(proof.message),
                scope: String(proof.scope),
                points: proof.points.map((point) => String(point))
            }
        };

        const response = await fetch(
            `${API_BASE}/api/v1/elections/${ELECTION_ID}/ballots`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        const result = await response.json() as {
            success?: boolean;
            message?: string;
            data?: {
                accepted?: boolean;
                accepted_ballot_count?: number;
                transaction_hash?: string;
            };
        };

        if (!response.ok || result.success !== true) {
            throw new Error(
                `${voter.label}: API submission failed: ${JSON.stringify(result)}`
            );
        }

        const updatedElection = await voting.getElection(ELECTION_ID);
        const updatedCount = Number(updatedElection.acceptedBallotCount);

        if (updatedCount !== index + 1) {
            throw new Error(
                `${voter.label}: on-chain ballot count verification failed.`
            );
        }

        console.log(
            `${voter.label}: API accepted; on-chain count ${updatedCount}; ` +
            `transaction ${result.data?.transaction_hash ?? "confirmed"}`
        );
    }

    const finalElection = await voting.getElection(ELECTION_ID);

    console.log("--------------------------------------");
    console.log("FINAL ACCEPTED BALLOTS:",
        Number(finalElection.acceptedBallotCount));
    console.log("API SUBMISSION TEST COMPLETED");
}

main().catch((error) => {
    console.error("BALLOT SUBMISSION FAILED:", error.message);
    process.exitCode = 1;
});
