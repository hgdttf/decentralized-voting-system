
import sodium from "libsodium-wrappers-sumo";

import {
    ElectionKeyPair,
    validateElectionKeyPair
} from "./ballot-crypto";

const VAULT_VERSION = 1;
const VAULT_ALGORITHM = "argon2id13+xchacha20poly1305";
const VAULT_CONTEXT = "decentralized-voting-election-key-v1";

export interface EncryptedElectionKeyBackup {
    version: number;
    algorithm: typeof VAULT_ALGORITHM;
    electionId: string;
    publicKey: string;
    salt: string;
    nonce: string;
    ciphertext: string;
}

async function initializeSodium(): Promise<void> {
    await sodium.ready;
}

function validatePassphrase(passphrase: string): void {
    if (
        typeof passphrase !== "string" ||
        passphrase.length < 12
    ) {
        throw new Error(
            "Passphrase must contain at least 12 characters."
        );
    }
}

function validateElectionId(electionId: string): void {
    if (
        typeof electionId !== "string" ||
        !/^[1-9][0-9]*$/.test(electionId)
    ) {
        throw new Error("Invalid election ID.");
    }
}

function validateHex(
    value: string,
    expectedBytes: number,
    fieldName: string
): void {
    if (
        typeof value !== "string" ||
        !new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, "i").test(value)
    ) {
        throw new Error(`Invalid ${fieldName}.`);
    }
}

function validateBackup(
    backup: EncryptedElectionKeyBackup
): void {
    if (
        !backup ||
        backup.version !== VAULT_VERSION ||
        backup.algorithm !== VAULT_ALGORITHM
    ) {
        throw new Error(
            "Unsupported or invalid election key backup."
        );
    }

    validateElectionId(backup.electionId);

    validateHex(
        backup.publicKey,
        sodium.crypto_box_PUBLICKEYBYTES,
        "public key"
    );

    validateHex(
        backup.salt,
        sodium.crypto_pwhash_SALTBYTES,
        "backup salt"
    );

    validateHex(
        backup.nonce,
        sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
        "backup nonce"
    );

    if (
        typeof backup.ciphertext !== "string" ||
        !/^(?:[0-9a-f]{2})+$/i.test(backup.ciphertext) ||
        backup.ciphertext.length <
            sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES * 2
    ) {
        throw new Error("Invalid backup ciphertext.");
    }
}

function createAdditionalData(
    electionId: string,
    publicKey: string
): Uint8Array {
    return sodium.from_string(
        `${VAULT_CONTEXT}:${electionId}:${publicKey.toLowerCase()}`
    );
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
 * Encrypts an election private key into a portable backup.
 *
 * The backup contains the public key and election ID,
 * but never stores the private key in plaintext.
 */
export async function encryptElectionKeyBackup(
    keyPair: ElectionKeyPair,
    electionId: string,
    passphrase: string
): Promise<EncryptedElectionKeyBackup> {
    await initializeSodium();

    validatePassphrase(passphrase);
    validateElectionId(electionId);

    if (
        !keyPair ||
        typeof keyPair.publicKey !== "string" ||
        typeof keyPair.privateKey !== "string"
    ) {
        throw new Error("Invalid election key pair.");
    }

    validateHex(
        keyPair.publicKey,
        sodium.crypto_box_PUBLICKEYBYTES,
        "public key"
    );

    validateHex(
        keyPair.privateKey,
        sodium.crypto_box_SECRETKEYBYTES,
        "private key"
    );

    const isValid = await validateElectionKeyPair(
        keyPair.publicKey,
        keyPair.privateKey
    );

    if (!isValid) {
        throw new Error(
            "Election public and private keys do not match."
        );
    }

    const salt = sodium.randombytes_buf(
        sodium.crypto_pwhash_SALTBYTES
    );

    const nonce = sodium.randombytes_buf(
        sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );

    const key = await deriveKey(passphrase, salt);
    const plaintext = sodium.from_hex(keyPair.privateKey);

    try {
        const ciphertext =
            sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                plaintext,
                createAdditionalData(
                    electionId,
                    keyPair.publicKey
                ),
                null,
                nonce,
                key,
                "hex"
            );

        return {
            version: VAULT_VERSION,
            algorithm: VAULT_ALGORITHM,
            electionId,
            publicKey: keyPair.publicKey.toLowerCase(),
            salt: sodium.to_hex(salt),
            nonce: sodium.to_hex(nonce),
            ciphertext
        };
    } finally {
        sodium.memzero(key);
        sodium.memzero(plaintext);
    }
}

/**
 * Decrypts and restores an election private key.
 *
 * Authentication failure, incorrect passphrase, or modified
 * election metadata causes the operation to fail.
 */
export async function decryptElectionKeyBackup(
    backup: EncryptedElectionKeyBackup,
    expectedElectionId: string,
    passphrase: string
): Promise<ElectionKeyPair> {
    await initializeSodium();

    validatePassphrase(passphrase);
    validateElectionId(expectedElectionId);
    validateBackup(backup);

    if (backup.electionId !== expectedElectionId) {
        throw new Error(
            "Election ID does not match the encrypted key backup."
        );
    }

    const salt = sodium.from_hex(backup.salt);
    const nonce = sodium.from_hex(backup.nonce);
    const ciphertext = sodium.from_hex(backup.ciphertext);

    const key = await deriveKey(passphrase, salt);

    let plaintext: Uint8Array | undefined;

    try {
        plaintext =
            sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                ciphertext,
                createAdditionalData(
                    backup.electionId,
                    backup.publicKey
                ),
                nonce,
                key
            );

        const privateKey = sodium.to_hex(plaintext);

        const isValid = await validateElectionKeyPair(
            backup.publicKey,
            privateKey
        );

        if (!isValid) {
            throw new Error(
                "Election key backup contains a mismatched key pair."
            );
        }

        return {
            publicKey: backup.publicKey,
            privateKey
        };
    } catch {
        throw new Error(
            "Election key backup decryption failed. Check the passphrase, election ID, or backup integrity."
        );
    } finally {
        if (plaintext) {
            sodium.memzero(plaintext);
        }

        sodium.memzero(key);
    }
}
