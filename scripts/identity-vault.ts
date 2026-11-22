import sodium from "libsodium-wrappers-sumo";
import { Identity } from "@semaphore-protocol/core";

const VAULT_VERSION = 1;
const VAULT_CONTEXT = "decentralized-voting-identity-v1";

export interface EncryptedIdentityBackup {
    version: number;
    algorithm: "argon2id13+xchacha20poly1305";
    salt: string;
    nonce: string;
    ciphertext: string;
}

async function initializeSodium(): Promise<void> {
    await sodium.ready;
}

function validatePassphrase(passphrase: string): void {
    if (typeof passphrase !== "string" || passphrase.length < 12) {
        throw new Error("Passphrase must contain at least 12 characters.");
    }
}

function validateBackup(backup: EncryptedIdentityBackup): void {
    if (
        !backup ||
        backup.version !== VAULT_VERSION ||
        backup.algorithm !== "argon2id13+xchacha20poly1305"
    ) {
        throw new Error("Unsupported or invalid identity backup.");
    }

    if (
        typeof backup.salt !== "string" ||
        typeof backup.nonce !== "string" ||
        typeof backup.ciphertext !== "string"
    ) {
        throw new Error("Invalid identity backup fields.");
    }

    if (!/^[0-9a-f]{32}$/i.test(backup.salt)) {
        throw new Error("Invalid backup salt.");
    }

    if (!/^[0-9a-f]{48}$/i.test(backup.nonce)) {
        throw new Error("Invalid backup nonce.");
    }

    if (
        !/^(?:[0-9a-f]{2})+$/i.test(backup.ciphertext) ||
        backup.ciphertext.length < sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES * 2
    ) {
        throw new Error("Invalid backup ciphertext.");
    }
}

async function deriveKey(
    passphrase: string,
    salt: Uint8Array
): Promise<Uint8Array> {
    return sodium.crypto_pwhash(
        sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
        passphrase,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13
    );
}

/**
 * Encrypts a Semaphore identity export into a portable backup.
 * The returned object contains no plaintext identity secret.
 */
export async function encryptIdentityBackup(
    identity: Identity,
    passphrase: string
): Promise<EncryptedIdentityBackup> {
    await initializeSodium();
    validatePassphrase(passphrase);

    if (!(identity instanceof Identity)) {
        throw new Error("A valid Semaphore identity is required.");
    }

    const salt = sodium.randombytes_buf(
        sodium.crypto_pwhash_SALTBYTES
    );

    const nonce = sodium.randombytes_buf(
        sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );

    const key = await deriveKey(passphrase, salt);

    try {
        const plaintext = sodium.from_string(identity.export());

        const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            plaintext,
            sodium.from_string(VAULT_CONTEXT),
            null,
            nonce,
            key,
            "hex"
        );

        return {
            version: VAULT_VERSION,
            algorithm: "argon2id13+xchacha20poly1305",
            salt: sodium.to_hex(salt),
            nonce: sodium.to_hex(nonce),
            ciphertext
        };
    } finally {
        sodium.memzero(key);
    }
}

/**
 * Decrypts and restores a previously encrypted Semaphore identity.
 * Authentication failure or an incorrect passphrase causes an error.
 */
export async function decryptIdentityBackup(
    backup: EncryptedIdentityBackup,
    passphrase: string
): Promise<Identity> {
    await initializeSodium();
    validatePassphrase(passphrase);
    validateBackup(backup);

    const salt = sodium.from_hex(backup.salt);
    const nonce = sodium.from_hex(backup.nonce);
    const ciphertext = sodium.from_hex(backup.ciphertext);

    const key = await deriveKey(passphrase, salt);

    try {
        const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            ciphertext,
            sodium.from_string(VAULT_CONTEXT),
            nonce,
            key
        );

        const exportedIdentity = sodium.to_string(plaintext);
        const identity = Identity.import(exportedIdentity);

        sodium.memzero(plaintext);

        return identity;
    } catch {
        throw new Error(
            "Identity backup decryption failed. Check the passphrase or backup integrity."
        );
    } finally {
        sodium.memzero(key);
    }
}
