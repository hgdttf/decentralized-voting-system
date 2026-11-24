
import { ethers } from "hardhat";

import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from "node:fs";

import { resolve } from "node:path";

import {
    generateElectionKeyPair
} from "./ballot-crypto";

import {
    decryptElectionKeyBackup,
    encryptElectionKeyBackup,
    EncryptedElectionKeyBackup
} from "./election-key-vault";

interface DeploymentFile {
    network: string;
    chainId: string;
    contracts: {
        voting: string;
        semaphore: string;
    };
}

async function main(): Promise<void> {
    console.log("\n========== PUBLISH ELECTION KEY ==========\n");

    // 1. Read election ID from environment.
    const electionIdInput = process.env.ELECTION_ID ?? "1";

    if (!/^[1-9][0-9]*$/.test(electionIdInput)) {
        throw new Error("Invalid election ID.");
    }

    const electionId = BigInt(electionIdInput);

    // 2. Read encryption passphrase.
    const passphrase = process.env.ELECTION_KEY_PASSPHRASE;

    if (!passphrase || passphrase.length < 12) {
        throw new Error(
            "Set ELECTION_KEY_PASSPHRASE to a passphrase of at least 12 characters."
        );
    }

    // 3. Load deployment information.
    const deploymentPath = resolve(
        __dirname,
        "../deployments/localhost.json"
    );

    if (!existsSync(deploymentPath)) {
        throw new Error("Local deployment file not found.");
    }

    const deployment: DeploymentFile = JSON.parse(
        readFileSync(deploymentPath, "utf-8")
    );

    if (
        deployment.network !== "localhost" ||
        deployment.chainId !== "1337"
    ) {
        throw new Error("Incorrect local deployment configuration.");
    }

    // 4. Verify blockchain network.
    const network = await ethers.provider.getNetwork();

    if (network.chainId !== 1337n) {
        throw new Error(
            `Expected chain ID 1337, received ${network.chainId}.`
        );
    }

    // 5. Connect administrator.
    const [admin] = await ethers.getSigners();

    console.log("Admin address:", admin.address);
    console.log("Chain ID:", network.chainId.toString());
    console.log("Voting contract:", deployment.contracts.voting);
    console.log("Election ID:", electionId.toString());

    // 6. Verify Voting contract deployment.
    const bytecode = await ethers.provider.getCode(
        deployment.contracts.voting
    );

    if (bytecode === "0x") {
        throw new Error("Voting contract not found.");
    }

    const voting = await ethers.getContractAt(
        "Voting",
        deployment.contracts.voting,
        admin
    );

    // 7. Verify election.
    const nextElectionId = await voting.nextElectionId();

    if (electionId >= nextElectionId) {
        throw new Error(
            `Election ${electionId} does not exist.`
        );
    }

    const election = await voting.getElection(electionId);

    const electionTitle = election[0] as string;
    const electionAdmin = election[1] as string;
    const electionStatus = BigInt(election[9]);

    console.log("\nElection title:", electionTitle);
    console.log("Election administrator:", electionAdmin);
    console.log("Election status:", electionStatus.toString());

    if (electionStatus !== 0n) {
        throw new Error(
            "Election must be in Registration status."
        );
    }

    if (
        electionAdmin.toLowerCase() !== admin.address.toLowerCase()
    ) {
        throw new Error(
            "Connected account is not the election administrator."
        );
    }

    // 8. Prepare private backup directory.
    const backupDirectory = resolve(
        __dirname,
        "../backups"
    );

    mkdirSync(backupDirectory, {
        recursive: true,
        mode: 0o700
    });

    const backupPath = resolve(
        backupDirectory,
        `election-${electionId}.election-key.json`
    );

    // 9. Read existing on-chain public key.
    const onChainPublicKey = (
        await voting.getElectionPublicKey(electionId)
    ).toLowerCase();

    let keyPair;

    if (existsSync(backupPath)) {
        console.log("\nExisting encrypted backup found.");

        const backup: EncryptedElectionKeyBackup = JSON.parse(
            readFileSync(backupPath, "utf-8")
        );

        keyPair = await decryptElectionKeyBackup(
            backup,
            electionId.toString(),
            passphrase
        );

        console.log("Existing backup successfully decrypted.");
    } else {
        if (onChainPublicKey !== "0x") {
            throw new Error(
                "A public key is already published, but its local backup is missing. Refusing to generate a replacement key."
            );
        }

        console.log("\nGenerating a new election key pair...");

        keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId.toString(),
            passphrase
        );

        // Exclusive creation prevents accidental overwriting.
        writeFileSync(
            backupPath,
            `${JSON.stringify(backup, null, 2)}\n`,
            {
                encoding: "utf-8",
                flag: "wx",
                mode: 0o600
            }
        );

        console.log("Encrypted private key backup saved.");
    }

    // 10. Validate public key length.
    const publicKeyBytes = `0x${keyPair.publicKey}`;

    if (ethers.getBytes(publicKeyBytes).length !== 32) {
        throw new Error(
            "Election public key must contain exactly 32 bytes."
        );
    }

    // 11. Publish public key.
    if (onChainPublicKey === "0x") {
        console.log("\nPublishing election public key...");

        const transaction = await voting.setElectionPublicKey(
            electionId,
            publicKeyBytes
        );

        console.log("Transaction hash:", transaction.hash);

        const receipt = await transaction.wait();

        if (!receipt || receipt.status !== 1) {
            throw new Error(
                "Election public key publication transaction failed."
            );
        }

        console.log("Public key successfully published.");
    } else {
        if (onChainPublicKey !== publicKeyBytes.toLowerCase()) {
            throw new Error(
                "Local backup public key does not match the on-chain public key."
            );
        }

        console.log(
            "\nMatching public key already exists on-chain."
        );
    }

    // 12. Verify published key.
    const verifiedPublicKey = (
        await voting.getElectionPublicKey(electionId)
    ).toLowerCase();

    if (verifiedPublicKey !== publicKeyBytes.toLowerCase()) {
        throw new Error(
            "On-chain public key verification failed."
        );
    }

    console.log("\n========== KEY VERIFICATION ==========");
    console.log("Election ID:", electionId.toString());
    console.log("Election:", electionTitle);
    console.log("Public key:", verifiedPublicKey);
    console.log("Private key backup:", backupPath);
    console.log("Private key published: NO");
    console.log("Public key verified: YES");
    console.log("======================================\n");
}

main().catch((error) => {
    console.error("\nElection key publication failed:");
    console.error(error);
    process.exitCode = 1;
});
