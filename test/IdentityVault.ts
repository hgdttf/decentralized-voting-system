import { Identity } from "@semaphore-protocol/core";
import { expect } from "chai";

import {
    createVoterIdentity,
    exportVoterIdentity,
    restoreVoterIdentity
} from "../scripts/identity-manager";

import {
    decryptIdentityBackup,
    encryptIdentityBackup
} from "../scripts/identity-vault";

describe("Voter Identity Management", function () {
    it("generates a valid identity and commitment", function () {
        const result = createVoterIdentity();

        expect(result.identity).to.be.instanceOf(Identity);
        expect(result.commitment).to.equal(
            result.identity.commitment.toString()
        );
        expect(BigInt(result.commitment)).to.be.greaterThan(0n);
    });

    it("restores an identity without changing its commitment", function () {
        const original = createVoterIdentity();
        const exported = exportVoterIdentity(original.identity);
        const restored = restoreVoterIdentity(exported);

        expect(restored.commitment).to.equal(original.commitment);
    });

    it("encrypts and decrypts an identity backup", async function () {
        const original = createVoterIdentity();
        const passphrase = "University-Voting-2026-Secure";

        const backup = await encryptIdentityBackup(
            original.identity,
            passphrase
        );

        const restored = await decryptIdentityBackup(
            backup,
            passphrase
        );

        expect(restored.commitment.toString()).to.equal(
            original.commitment
        );
    });

    it("rejects an incorrect passphrase", async function () {
        const original = createVoterIdentity();

        const backup = await encryptIdentityBackup(
            original.identity,
            "University-Voting-2026-Secure"
        );

        let failed = false;

        try {
            await decryptIdentityBackup(
                backup,
                "Incorrect-Passphrase-2026"
            );
        } catch {
            failed = true;
        }

        expect(failed).to.equal(true);
    });

    it("rejects a modified backup", async function () {
        const original = createVoterIdentity();

        const backup = await encryptIdentityBackup(
            original.identity,
            "University-Voting-2026-Secure"
        );

        const modifiedBackup = {
            ...backup,
            ciphertext: backup.ciphertext.slice(0, -2) + "00"
        };

        let failed = false;

        try {
            await decryptIdentityBackup(
                modifiedBackup,
                "University-Voting-2026-Secure"
            );
        } catch {
            failed = true;
        }

        expect(failed).to.equal(true);
    });

    it("rejects a weak passphrase", async function () {
        const original = createVoterIdentity();

        let failed = false;

        try {
            await encryptIdentityBackup(original.identity, "weak");
        } catch {
            failed = true;
        }

        expect(failed).to.equal(true);
    });
});
