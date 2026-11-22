import sodium from "libsodium-wrappers-sumo";

export interface ElectionKeyPair {
    publicKey: string
    privateKey: string
}

const HEX_PATTERN = /^[0-9a-f]+$/i

async function initializeSodium(): Promise<void> {
    await sodium.ready
}

function validateHex(value: string, fieldName: string): void {
    if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || !HEX_PATTERN.test(value)) {
        throw new Error(`Invalid ${fieldName} encoding.`)
    }
}

function validateKey(key: string, expectedBytes: number, fieldName: string): Uint8Array {
    validateHex(key, fieldName)

    const decoded = sodium.from_hex(key)

    if (decoded.length !== expectedBytes) {
        throw new Error(`Invalid ${fieldName} length.`)
    }

    return decoded
}

export async function generateElectionKeyPair(): Promise<ElectionKeyPair> {
    await initializeSodium()

    const keyPair = sodium.crypto_box_keypair("hex")

    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey
    }
}

export async function validateElectionKeyPair(publicKey: string, privateKey: string): Promise<boolean> {
    await initializeSodium()

    const recipientPublicKey = validateKey(publicKey, sodium.crypto_box_PUBLICKEYBYTES, "public key")

    const recipientPrivateKey = validateKey(privateKey, sodium.crypto_box_SECRETKEYBYTES, "private key")

    const derivedPublicKey = sodium.crypto_scalarmult_base(recipientPrivateKey)

    return sodium.memcmp(derivedPublicKey, recipientPublicKey)
}

export async function encryptBallot(ballot: string, publicKey: string): Promise<string> {
    await initializeSodium()

    if (typeof ballot !== "string" || ballot.length === 0) {
        throw new Error("Ballot must not be empty.")
    }

    const recipientPublicKey = validateKey(publicKey, sodium.crypto_box_PUBLICKEYBYTES, "public key")

    return sodium.crypto_box_seal(sodium.from_string(ballot), recipientPublicKey, "hex")
}

export async function decryptBallot(ciphertext: string, publicKey: string, privateKey: string): Promise<string> {
    await initializeSodium()

    validateHex(ciphertext, "ciphertext")

    const isMatchingKeyPair = await validateElectionKeyPair(publicKey, privateKey)

    if (!isMatchingKeyPair) {
        throw new Error("Public and private keys do not form a pair.")
    }

    const encryptedBytes = sodium.from_hex(ciphertext)

    if (encryptedBytes.length < sodium.crypto_box_SEALBYTES) {
        throw new Error("Invalid ciphertext length.")
    }

    try {
        const plaintext = sodium.crypto_box_seal_open(
            encryptedBytes,
            sodium.from_hex(publicKey),
            sodium.from_hex(privateKey)
        )

        const decoded = sodium.to_string(plaintext)

        if (decoded.length === 0) {
            throw new Error("Decrypted ballot is empty.")
        }

        return decoded
    } catch {
        throw new Error("Ballot decryption failed.")
    }
}
