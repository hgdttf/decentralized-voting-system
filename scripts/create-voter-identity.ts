
import * as fs from "node:fs";
import * as path from "node:path";

import { createVoterIdentity } from "./identity-manager";
import {
    encryptIdentityBackup,
    decryptIdentityBackup,
} from "./identity-vault";

async function main(): Promise<void> {
    const electionId = process.env.ELECTION_ID;
    const voterLabel = process.env.VOTER_LABEL;
    const passphrase = process.env.IDENTITY_VAULT_PASSPHRASE;

    if (!electionId || !/^[1-9]\d*$/.test(electionId)) {
        throw new Error("ELECTION_ID must be a positive integer.");
    }

    if (
        !voterLabel ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(voterLabel)
    ) {
        throw new Error(
            "VOTER_LABEL must contain 1-40 letters, numbers, underscores, or hyphens."
        );
    }

    if (!passphrase || passphrase.length < 12) {
        throw new Error(
            "IDENTITY_VAULT_PASSPHRASE must contain at least 12 characters."
        );
    }

    const backupDirectory = path.join(process.cwd(), "backups");
    const backupPath = path.join(
        backupDirectory,
        `election-${electionId}-${voterLabel}-identity.json`
    );

    // Never overwrite an existing identity backup.
    if (fs.existsSync(backupPath)) {
        throw new Error(
            `Backup already exists: ${backupPath}. Choose a different VOTER_LABEL.`
        );
    }

    // Create the identity and its public commitment.
    const { identity, commitment } = await createVoterIdentity();

    // Encrypt the identity backup using the supplied passphrase.
    const encryptedBackup = await encryptIdentityBackup(
        identity,
        passphrase
    );

    // Restore the encrypted backup to verify that it is recoverable.
    const restoredIdentity = await decryptIdentityBackup(
        encryptedBackup,
        passphrase
    );

    // Confirm that restoration produces the same public commitment.
    const originalCommitment = String(commitment);
    const restoredCommitment = String(restoredIdentity.commitment);

    if (originalCommitment !== restoredCommitment) {
        throw new Error(
            "Identity restoration verification failed. Backup was not saved."
        );
    }

    // Create a private backup directory.
    fs.mkdirSync(backupDirectory, {
        recursive: true,
        mode: 0o700,
    });

    // Save the encrypted backup without overwriting an existing file.
    fs.writeFileSync(
        backupPath,
        JSON.stringify(encryptedBackup, null, 2),
        {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
        }
    );

    console.log("\nVoter identity created successfully.");
    console.log("--------------------------------------");
    console.log(`Election ID: ${electionId}`);
    console.log(`Voter label: ${voterLabel}`);
    console.log(`Commitment: ${originalCommitment}`);
    console.log(`Encrypted backup: ${backupPath}`);
    console.log("Backup restoration: VERIFIED");
    console.log("--------------------------------------");
    console.log(
        "Keep the passphrase and encrypted backup secure."
    );
    console.log("The private identity was not printed.");
}

main().catch((error: unknown) => {
    console.error("\nIdentity creation failed:");

    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error(error);
    }

    process.exitCode = 1;
});
