
import { ethers } from "hardhat";

import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from "node:fs";

import { join } from "node:path";

import {
    decryptBallot,
    generateElectionKeyPair
} from "./ballot-crypto";

import {
    decryptElectionKeyBackup,
    encryptElectionKeyBackup
} from "./election-key-vault";

import type {
    EncryptedElectionKeyBackup
} from "./election-key-vault";

type Payload = Record<string, unknown>;

interface BridgeRequest {
    action: string;
    payload?: Payload;
}

interface Deployment {
    network: string;
    chainId: string;
    contracts: {
        voting: string;
        semaphore: string;
    };
}

const ROOT = process.cwd();

const DEPLOYMENT_PATH = join(
    ROOT,
    "deployments",
    "localhost.json"
);

const BACKUP_DIR = join(ROOT, "backups");

function fail(message: string): never {
    throw new Error(message);
}

function requiredString(
    value: unknown,
    field: string
): string {
    if (
        typeof value !== "string" ||
        value.trim() === ""
    ) {
        return fail(`${field} is required.`);
    }

    return value.trim();
}

function positiveInteger(
    value: unknown,
    field: string
): bigint {
    const text = String(value ?? "");

    if (!/^[1-9]\d*$/.test(text)) {
        return fail(
            `${field} must be a positive integer.`
        );
    }

    const result = BigInt(text);

    if (result >= 2n ** 256n) {
        return fail(`${field} exceeds uint256.`);
    }

    return result;
}

function parseHex(
    value: unknown,
    field: string
): string {
    const text = requiredString(value, field);

    if (!/^0x(?:[0-9a-f]{2})+$/i.test(text)) {
        return fail(
            `${field} must be valid hexadecimal bytes.`
        );
    }

    return text;
}

function parseCandidates(value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        value.length < 2
    ) {
        return fail(
            "At least two candidates are required."
        );
    }

    const candidates = value.map((item, index) =>
        requiredString(
            item,
            `candidates[${index}]`
        )
    );

    if (candidates.length > 100) {
        return fail(
            "Maximum candidate count is 100."
        );
    }

    if (
        new Set(candidates).size !== candidates.length
    ) {
        return fail(
            "Candidate names must be unique."
        );
    }

    if (
        candidates.some(
            (name) => name.length > 128
        )
    ) {
        return fail(
            "Candidate names must not exceed 128 characters."
        );
    }

    return candidates;
}

// --------------------------------------------------
// BLOCKCHAIN CONNECTION
// --------------------------------------------------

async function connect() {
    if (!existsSync(DEPLOYMENT_PATH)) {
        return fail(
            "Localhost deployment file was not found."
        );
    }

    const deployment = JSON.parse(
        readFileSync(DEPLOYMENT_PATH, "utf8")
    ) as Deployment;

    if (
        deployment.network !== "localhost" ||
        deployment.chainId !== "1337"
    ) {
        return fail(
            "Only the localhost chain deployment is supported."
        );
    }

    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        return fail(
            "Connected blockchain is not chain ID 1337."
        );
    }

    const [signer] = await ethers.getSigners();

    if (!signer) {
        return fail(
            "No Hardhat signer is available."
        );
    }

    const code = await ethers.provider.getCode(
        deployment.contracts.voting
    );

    if (code === "0x") {
        return fail(
            "Voting contract is not deployed."
        );
    }

    const voting = await ethers.getContractAt(
        "Voting",
        deployment.contracts.voting,
        signer
    );

    return {
        voting: voting as any,
        signer
    };
}

// --------------------------------------------------
// ADMIN VERIFICATION
// --------------------------------------------------

async function verifyAdmin(
    voting: any,
    electionId: bigint,
    signerAddress: string
) {
    const election = await voting.getElection(
        electionId
    );

    if (
        String(election.admin).toLowerCase() !==
        signerAddress.toLowerCase()
    ) {
        return fail(
            "Configured signer is not the election administrator."
        );
    }

    return election;
}

// --------------------------------------------------
// TRANSACTION VERIFICATION
// --------------------------------------------------

async function confirmTransaction(tx: any) {
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
        return fail(
            "Blockchain transaction failed."
        );
    }

    return {
        transaction_hash: receipt.hash,
        block_number: Number(receipt.blockNumber)
    };
}

// --------------------------------------------------
// CREATE ELECTION
// --------------------------------------------------

async function createElection(payload: Payload) {
    const title = requiredString(
        payload.title,
        "title"
    );

    const startTime = positiveInteger(
        payload.start_time,
        "start_time"
    );

    const endTime = positiveInteger(
        payload.end_time,
        "end_time"
    );

    const candidates = parseCandidates(
        payload.candidates
    );

    if (title.length > 200) {
        return fail(
            "Election title must not exceed 200 characters."
        );
    }

    if (endTime <= startTime) {
        return fail(
            "End time must be later than start time."
        );
    }

    const { voting, signer } = await connect();

    const block = await ethers.provider.getBlock(
        "latest"
    );

    if (
        !block ||
        startTime <= BigInt(block.timestamp)
    ) {
        return fail(
            "Election start time must be in the future."
        );
    }

    const electionId = BigInt(
        await voting.nextElectionId()
    );

    const createTx = await voting.createElection(
        title,
        startTime,
        endTime
    );

    const creation = await confirmTransaction(
        createTx
    );

    const candidateTransactions: string[] = [];

    for (const name of candidates) {
        const tx = await voting.addCandidate(
            electionId,
            name
        );

        const result = await confirmTransaction(tx);

        candidateTransactions.push(
            result.transaction_hash
        );
    }

    const election = await voting.getElection(
        electionId
    );

    if (
        String(election.admin).toLowerCase() !==
        signer.address.toLowerCase()
    ) {
        return fail(
            "Election administrator verification failed."
        );
    }

    const storedCandidates = await voting.getCandidates(
        electionId
    );

    if (
        storedCandidates.length !== candidates.length
    ) {
        return fail(
            "Candidate count verification failed."
        );
    }

    return {
        election_id: electionId.toString(),
        title,
        status: "Registration",
        administrator: signer.address,
        candidate_count: storedCandidates.length,
        creation_transaction: creation.transaction_hash,
        candidate_transactions: candidateTransactions
    };
}

// --------------------------------------------------
// ADD CANDIDATE
// --------------------------------------------------

async function addCandidate(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const name = requiredString(
        payload.name,
        "name"
    );

    if (name.length > 128) {
        return fail(
            "Candidate name is too long."
        );
    }

    const { voting, signer } = await connect();

    const election = await verifyAdmin(
        voting,
        electionId,
        signer.address
    );

    if (Number(election.status) !== 0) {
        return fail(
            "Candidates can only be added during Registration."
        );
    }

    const existing = await voting.getCandidates(
        electionId
    );

    if (
        Array.from(existing).some(
            (candidate: any) =>
                String(candidate.name) === name
        )
    ) {
        return fail(
            "Candidate already exists."
        );
    }

    const tx = await voting.addCandidate(
        electionId,
        name
    );

    const result = await confirmTransaction(tx);

    return {
        election_id: electionId.toString(),
        candidate_count: (
            await voting.getCandidates(electionId)
        ).length,
        ...result
    };
}

// --------------------------------------------------
// REGISTER VOTER
// --------------------------------------------------

async function registerVoter(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const commitment = positiveInteger(
        payload.commitment,
        "commitment"
    );

    const { voting, signer } = await connect();

    const election = await verifyAdmin(
        voting,
        electionId,
        signer.address
    );

    if (Number(election.status) !== 0) {
        return fail(
            "Voter registration is closed."
        );
    }

    if (
        await voting.registeredCommitments(
            electionId,
            commitment
        )
    ) {
        return {
            election_id: electionId.toString(),
            registered: true,
            already_registered: true
        };
    }

    const tx = await voting.registerVoter(
        electionId,
        commitment
    );

    const result = await confirmTransaction(tx);

    const verified = await voting.registeredCommitments(
        electionId,
        commitment
    );

    if (!verified) {
        return fail(
            "Voter registration could not be verified."
        );
    }

    const updated = await voting.getElection(
        electionId
    );

    return {
        election_id: electionId.toString(),
        registered: true,
        already_registered: false,
        registered_voter_count: String(
            updated.registeredVoterCount
        ),
        ...result
    };
}

// --------------------------------------------------
// PUBLISH ELECTION ENCRYPTION KEY
// --------------------------------------------------


async function publishElectionKey(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const passphrase = requiredString(
        process.env.ELECTION_KEY_PASSPHRASE,
        "ELECTION_KEY_PASSPHRASE"
    );

    if (passphrase.length < 12) {
        return fail("Election key passphrase is too short.");
    }

    const { voting, signer } = await connect();

    const election = await verifyAdmin(
        voting,
        electionId,
        signer.address
    );

    if (Number(election.status) !== 0) {
        return fail(
            "Election key can only be published during Registration."
        );
    }

    mkdirSync(BACKUP_DIR, {
        recursive: true,
        mode: 0o700,
    });

    const backupPath = join(
        BACKUP_DIR,
        `election-${electionId}.election-key.json`
    );

    const existingPublicKey = String(
        await voting.getElectionPublicKey(electionId)
    ).toLowerCase();

    // Solidity returns bytes memory, not bytes32.
    // An unpublished key is therefore represented by "0x".
    const keyIsUnset = existingPublicKey === "0x";

    let keyPair: any;

    if (existsSync(backupPath)) {
        const backup = JSON.parse(
            readFileSync(backupPath, "utf8")
        ) as EncryptedElectionKeyBackup;

        keyPair = await decryptElectionKeyBackup(
            backup,
            electionId.toString(),
            passphrase
        );
    } else {
        if (!keyIsUnset) {
            return fail(
                "On-chain public key exists, but its encrypted private-key backup is missing."
            );
        }

        keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId.toString(),
            passphrase
        );

        // Save the encrypted private-key backup before publishing.
        writeFileSync(
            backupPath,
            `${JSON.stringify(backup, null, 2)}\n`,
            {
                encoding: "utf8",
                flag: "wx",
                mode: 0o600,
            }
        );
    }

    const publicKey = `0x${keyPair.publicKey}`;

    if (keyIsUnset) {
        const tx = await voting.setElectionPublicKey(
            electionId,
            publicKey
        );

        await confirmTransaction(tx);
    } else if (
        existingPublicKey !== publicKey.toLowerCase()
    ) {
        return fail(
            "Local key backup does not match the on-chain public key."
        );
    }

    // Verify that the public key was correctly stored on-chain.
    const verified = String(
        await voting.getElectionPublicKey(electionId)
    ).toLowerCase();

    if (verified !== publicKey.toLowerCase()) {
        return fail(
            "Public key publication verification failed."
        );
    }

    return {
        election_id: electionId.toString(),
        public_key: verified,
        public_key_published: true,
        private_key_exposed: false,
    };
}

// --------------------------------------------------
// START VOTING
// --------------------------------------------------

async function startVoting(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const { voting, signer } = await connect();

    const election = await verifyAdmin(
        voting,
        electionId,
        signer.address
    );

    if (Number(election.status) !== 0) {
        return fail(
            "Election is not in Registration status."
        );
    }

    const candidates = await voting.getCandidates(
        electionId
    );

    if (candidates.length < 2) {
        return fail(
            "At least two candidates are required."
        );
    }

    if (
        BigInt(election.registeredVoterCount) < 3n
    ) {
        return fail(
            "At least three registered voters are required."
        );
    }

    const publicKey = String(
        await voting.getElectionPublicKey(electionId)
    );

    if (!/^0x[0-9a-f]{64}$/i.test(publicKey)) {
        return fail(
            "Election public key has not been published."
        );
    }

    if (publicKey.toLowerCase() === ethers.ZeroHash.toLowerCase()) {
        return fail(
            "Election public key has not been published."
        );
    }

    const tx = await voting.startVoting(
        electionId
    );

    const result = await confirmTransaction(tx);

    const updated = await voting.getElection(
        electionId
    );

    if (Number(updated.status) !== 1) {
        return fail(
            "Voting activation verification failed."
        );
    }

    return {
        election_id: electionId.toString(),
        status: "Voting",
        ...result
    };
}

// --------------------------------------------------
// SUBMIT ANONYMOUS ENCRYPTED BALLOT
// --------------------------------------------------

async function submitBallot(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const ciphertext = parseHex(
        payload.encrypted_ballot,
        "encrypted_ballot"
    );

    const input = payload.proof;

    if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input)
    ) {
        return fail(
            "Semaphore proof must be an object."
        );
    }

    const proofInput = input as Payload;

    const { points } = proofInput;

    if (
        !Array.isArray(points) ||
        points.length !== 8
    ) {
        return fail(
            "Semaphore proof must contain exactly eight points."
        );
    }

    const proof = {
        merkleTreeDepth: positiveInteger(
            proofInput.merkleTreeDepth,
            "merkleTreeDepth"
        ),

        merkleTreeRoot: positiveInteger(
            proofInput.merkleTreeRoot,
            "merkleTreeRoot"
        ),

        nullifier: positiveInteger(
            proofInput.nullifier,
            "nullifier"
        ),

        message: positiveInteger(
            proofInput.message,
            "message"
        ),

        scope: positiveInteger(
            proofInput.scope,
            "scope"
        ),

        points: points.map((point, index) =>
            positiveInteger(
                point,
                `points[${index}]`
            )
        )
    };

    const { voting } = await connect();

    const election = await voting.getElection(
        electionId
    );

    if (Number(election.status) !== 1) {
        return fail(
            "Election is not accepting ballots."
        );
    }

    const expectedMessage = BigInt(
        ethers.keccak256(ciphertext)
    );

    if (proof.message !== expectedMessage) {
        return fail(
            "Proof message does not match encrypted ballot."
        );
    }

    if (
        proof.scope !== BigInt(election.scope)
    ) {
        return fail(
            "Proof scope does not match election scope."
        );
    }

    const previousCount = BigInt(
        election.acceptedBallotCount
    );

    const tx = await voting.submitBallot(
        electionId,
        ciphertext,
        proof
    );

    const result = await confirmTransaction(tx);

    const updated = await voting.getElection(
        electionId
    );

    const currentCount = BigInt(
        updated.acceptedBallotCount
    );

    if (currentCount !== previousCount + 1n) {
        return fail(
            "Ballot acceptance verification failed."
        );
    }

    return {
        election_id: electionId.toString(),
        accepted: true,
        accepted_ballot_count: currentCount.toString(),
        ...result
    };
}

// --------------------------------------------------
// CLOSE ELECTION
// --------------------------------------------------

async function closeElection(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const { voting } = await connect();

    const election = await voting.getElection(
        electionId
    );

    if (Number(election.status) !== 1) {
        return fail(
            "Election is not currently in Voting status."
        );
    }

    const block = await ethers.provider.getBlock(
        "latest"
    );

    if (
        !block ||
        BigInt(block.timestamp) < BigInt(election.endTime)
    ) {
        return fail(
            "Election deadline has not been reached."
        );
    }

    const tx = await voting.closeElection(
        electionId
    );

    const result = await confirmTransaction(tx);

    const updated = await voting.getElection(
        electionId
    );

    if (Number(updated.status) !== 2) {
        return fail(
            "Election closure verification failed."
        );
    }

    return {
        election_id: electionId.toString(),
        status: "Closed",
        ...result
    };
}

// --------------------------------------------------
// TALLY AND FINALIZE ELECTION
// --------------------------------------------------

async function tallyElection(payload: Payload) {
    const electionId = positiveInteger(
        payload.election_id,
        "election_id"
    );

    const passphrase = requiredString(
        process.env.ELECTION_KEY_PASSPHRASE,
        "ELECTION_KEY_PASSPHRASE"
    );

    const { voting, signer } = await connect();

    const election = await verifyAdmin(
        voting,
        electionId,
        signer.address
    );

    if (Number(election.status) !== 2) {
        return fail(
            "Election must be Closed before tallying."
        );
    }

    const backupPath = join(
        BACKUP_DIR,
        `election-${electionId}.election-key.json`
    );

    if (!existsSync(backupPath)) {
        return fail(
            "Encrypted election key backup is missing."
        );
    }

    const backup = JSON.parse(
        readFileSync(backupPath, "utf8")
    ) as EncryptedElectionKeyBackup;

    const keys = await decryptElectionKeyBackup(
        backup,
        electionId.toString(),
        passphrase
    );

    const onChainKey = String(
        await voting.getElectionPublicKey(electionId)
    ).toLowerCase();

    if (
        onChainKey !==
        `0x${keys.publicKey}`.toLowerCase()
    ) {
        return fail(
            "Restored private key does not match election public key."
        );
    }

    const candidates = await voting.getCandidates(
        electionId
    );

    const names = Array.from(
        candidates,
        (candidate: any) => String(candidate.name)
    );

    if (
        names.length < 2 ||
        names.some((name) => !name) ||
        new Set(names).size !== names.length
    ) {
        return fail(
            "Election candidate list is invalid."
        );
    }

    const encryptedBallots = await voting.getEncryptedBallots(
        electionId
    );

    const accepted = BigInt(
        election.acceptedBallotCount
    );

    if (
        BigInt(encryptedBallots.length) !== accepted ||
        accepted === 0n
    ) {
        return fail(
            "Encrypted ballot count does not match accepted ballot count."
        );
    }

    const tally = new Map<string, bigint>(
        names.map((name) => [name, 0n])
    );

    for (const encrypted of encryptedBallots) {
        const ciphertext = String(encrypted);

        if (!/^0x(?:[0-9a-f]{2})+$/i.test(ciphertext)) {
            return fail(
                "Invalid encrypted ballot encoding."
            );
        }

        let plaintext: string;

        try {
            plaintext = await decryptBallot(
                ciphertext.slice(2),
                keys.publicKey,
                keys.privateKey
            );
        } catch {
            return fail(
                "A ballot could not be decrypted. Tally was not finalized."
            );
        }

        if (!tally.has(plaintext)) {
            return fail(
                "A ballot contains an invalid candidate selection."
            );
        }

        tally.set(
            plaintext,
            tally.get(plaintext)! + 1n
        );
    }

    const voteCounts = names.map(
        (name) => tally.get(name)!
    );

    const total = voteCounts.reduce(
        (sum, value) => sum + value,
        0n
    );

    if (total !== accepted) {
        return fail(
            "Tally does not match accepted ballot count."
        );
    }

    const tx = await voting.finalizeElection(
        electionId,
        voteCounts
    );

    const result = await confirmTransaction(tx);

    const finalized = await voting.getElection(
        electionId
    );

    if (
        Number(finalized.status) !== 3 ||
        BigInt(finalized.totalValidVotes) !== total
    ) {
        return fail(
            "Finalized election verification failed."
        );
    }

    const results: Array<{
        candidate_id: number;
        candidate_name: string;
        votes: string;
    }> = [];

    for (
        let index = 0;
        index < names.length;
        index += 1
    ) {
        const onChainCount = BigInt(
            await voting.getCandidateVoteCount(
                electionId,
                index + 1
            )
        );

        if (onChainCount !== voteCounts[index]) {
            return fail(
                "Candidate tally verification failed."
            );
        }

        results.push({
            candidate_id: index + 1,
            candidate_name: names[index],
            votes: onChainCount.toString()
        });
    }

    return {
        election_id: electionId.toString(),
        status: "Finalized",
        total_valid_votes: total.toString(),
        results,
        ...result
    };
}

// --------------------------------------------------
// REQUEST DISPATCHER
// --------------------------------------------------

async function dispatch(
    request: BridgeRequest
): Promise<unknown> {
    const payload = request.payload ?? {};

    switch (request.action) {
        case "create_election":
            return createElection(payload);

        case "add_candidate":
            return addCandidate(payload);

        case "register_voter":
            return registerVoter(payload);

        case "publish_election_key":
            return publishElectionKey(payload);

        case "start_voting":
            return startVoting(payload);

        case "submit_ballot":
            return submitBallot(payload);

        case "close_election":
            return closeElection(payload);

        case "tally_election":
            return tallyElection(payload);

        default:
            return fail(
                "Unsupported bridge action."
            );
    }
}

// --------------------------------------------------
// MAIN ENTRY POINT
// --------------------------------------------------

async function main(): Promise<void> {
    try {
        const chunks: Buffer[] = [];

        for await (const chunk of process.stdin) {
            chunks.push(
                Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk)
            );
        }

        const input = Buffer.concat(chunks)
            .toString("utf8")
            .trim();

        if (!input) {
            throw new Error(
                "No JSON request received on stdin."
            );
        }

        let request: BridgeRequest;

        try {
            request = JSON.parse(input) as BridgeRequest;
        } catch {
            throw new Error(
                "Invalid JSON request."
            );
        }

        if (
            !request ||
            typeof request.action !== "string" ||
            request.action.trim().length === 0
        ) {
            throw new Error(
                "A valid bridge action is required."
            );
        }

        const result = await dispatch(request);

        process.stdout.write(
            `${JSON.stringify({
                success: true,
                data: result
            })}\n`
        );

    } catch (error: unknown) {
        const message =
            error instanceof Error
                ? error.message
                : "Unexpected bridge error.";

        process.stderr.write(
            `[API BRIDGE ERROR] ${message}\n`
        );

        process.stdout.write(
            `${JSON.stringify({
                success: false,
                error: message
            })}\n`
        );

        process.exitCode = 1;
    }
}

main();
