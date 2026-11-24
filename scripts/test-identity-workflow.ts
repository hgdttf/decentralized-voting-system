
import fs from "node:fs";
import path from "node:path";

import {
    createVoterIdentity,
    exportVoterIdentity,
} from "./identity-manager";

import {
    encryptIdentityBackup,
    decryptIdentityBackup,
} from "./identity-vault";

async function main(): Promise<void> {
    const passphrase = process.env.IDENTITY_VAULT_PASSPHRASE;

    if (!passphrase || passphrase.length < 12) {
        throw new Error(
            "Set IDENTITY_VAULT_PASSPHRASE to a passphrase of at least 12 characters."
        );
    }

    const { identity, commitment } = createVoterIdentity();

    console.log("Semaphore identity generated.");
    console.log("Commitment:", commitment);

    const backup = await encryptIdentityBackup(identity, passphrase);

    const backupDirectory = path.join(process.cwd(), "backups");

    fs.mkdirSync(backupDirectory, { recursive: true });

    const backupPath = path.join(
        backupDirectory,
        "election-2-voter-identity.json"
    );

    fs.writeFileSync(
        backupPath,
        JSON.stringify(backup, null, 2),
        { encoding: "utf8", mode: 0o600, flag: "wx" }
    );

    console.log("Encrypted identity backup created.");

    const restoredIdentity = await decryptIdentityBackup(
        backup,
        passphrase
    );

    if (restoredIdentity.commitment.toString() !== commitment) {
        throw new Error("Restored identity commitment does not match.");
    }

    console.log("Identity restoration verified.");

    const exportedIdentity = exportVoterIdentity(restoredIdentity);

    if (!exportedIdentity) {
        throw new Error("Restored identity export is empty.");
    }

    try {
        await decryptIdentityBackup(backup, "incorrect-test-passphrase");
        throw new Error("Incorrect passphrase was unexpectedly accepted.");
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "Incorrect passphrase was unexpectedly accepted."
        ) {
            throw error;
        }

        console.log("Incorrect passphrase correctly rejected.");
    }

    console.log("\nIdentity workflow verification PASSED.");
    console.log("Backup path:", backupPath);
    console.log("Commitment:", commitment);
    console.log("Private identity exported: NO");
}

main().catch((error: unknown) => {
    console.error("Identity workflow failed:", error);
    process.exitCode = 1;
});
