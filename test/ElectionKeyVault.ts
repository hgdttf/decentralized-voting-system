
import { expect } from "chai";

import {
    generateElectionKeyPair
} from "../scripts/ballot-crypto";

import {
    decryptElectionKeyBackup,
    encryptElectionKeyBackup
} from "../scripts/election-key-vault";


describe("Election Key Vault", () => {
    const electionId = "1";
    const passphrase = "University-Election-2026-Secure";

    it("encrypts and restores an election key pair", async () => {
        const original = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            original,
            electionId,
            passphrase
        );

        const restored = await decryptElectionKeyBackup(
            backup,
            electionId,
            passphrase
        );

        expect(restored.publicKey).to.equal(original.publicKey);
        expect(restored.privateKey).to.equal(original.privateKey);
    });

    it("stores the election ID and public key in the backup", async () => {
        const keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId,
            passphrase
        );

        expect(backup.electionId).to.equal(electionId);
        expect(backup.publicKey).to.equal(
            keyPair.publicKey.toLowerCase()
        );
        expect(backup.version).to.equal(1);
    });

    it("does not expose the private key in the backup", async () => {
        const keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId,
            passphrase
        );

        const serializedBackup = JSON.stringify(backup);

        expect(serializedBackup).to.not.include(
            keyPair.privateKey
        );
    });

    it("rejects an incorrect passphrase", async () => {
        const keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId,
            passphrase
        );

        try {
            await decryptElectionKeyBackup(
                backup,
                electionId,
                "Incorrect-Passphrase-2026"
            );

            expect.fail("Incorrect passphrase should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Election key backup decryption failed. Check the passphrase, election ID, or backup integrity."
            );
        }
    });

    it("rejects a backup belonging to another election", async () => {
        const keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId,
            passphrase
        );

        try {
            await decryptElectionKeyBackup(
                backup,
                "2",
                passphrase
            );

            expect.fail(
                "A different election ID should be rejected."
            );
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Election ID does not match the encrypted key backup."
            );
        }
    });

    it("rejects a modified ciphertext", async () => {
        const keyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            keyPair,
            electionId,
            passphrase
        );

        const firstCharacter =
            backup.ciphertext[0] === "0" ? "1" : "0";

        const modifiedBackup = {
            ...backup,
            ciphertext:
                firstCharacter + backup.ciphertext.slice(1)
        };

        try {
            await decryptElectionKeyBackup(
                modifiedBackup,
                electionId,
                passphrase
            );

            expect.fail("Modified ciphertext should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Election key backup decryption failed. Check the passphrase, election ID, or backup integrity."
            );
        }
    });

    it("rejects a modified public key", async () => {
        const original = await generateElectionKeyPair();
        const anotherKeyPair = await generateElectionKeyPair();

        const backup = await encryptElectionKeyBackup(
            original,
            electionId,
            passphrase
        );

        const modifiedBackup = {
            ...backup,
            publicKey: anotherKeyPair.publicKey
        };

        try {
            await decryptElectionKeyBackup(
                modifiedBackup,
                electionId,
                passphrase
            );

            expect.fail("Modified public key should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Election key backup decryption failed. Check the passphrase, election ID, or backup integrity."
            );
        }
    });

    it("rejects a mismatched key pair during encryption", async () => {
        const firstKeyPair = await generateElectionKeyPair();
        const secondKeyPair = await generateElectionKeyPair();

        try {
            await encryptElectionKeyBackup(
                {
                    publicKey: firstKeyPair.publicKey,
                    privateKey: secondKeyPair.privateKey
                },
                electionId,
                passphrase
            );

            expect.fail("Mismatched keys should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Election public and private keys do not match."
            );
        }
    });

    it("rejects a weak passphrase", async () => {
        const keyPair = await generateElectionKeyPair();

        try {
            await encryptElectionKeyBackup(
                keyPair,
                electionId,
                "weak"
            );

            expect.fail("Weak passphrase should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Passphrase must contain at least 12 characters."
            );
        }
    });

    it("rejects an invalid election ID", async () => {
        const keyPair = await generateElectionKeyPair();

        try {
            await encryptElectionKeyBackup(
                keyPair,
                "0",
                passphrase
            );

            expect.fail("Invalid election ID should be rejected.");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Invalid election ID."
            );
        }
    });
});
