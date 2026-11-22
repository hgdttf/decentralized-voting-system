import { expect } from "chai"
import {
    decryptBallot,
    encryptBallot,
    generateElectionKeyPair,
    validateElectionKeyPair
} from "../scripts/ballot-crypto"

describe("Ballot Encryption", () => {
    let publicKey: string
    let privateKey: string

    before(async () => {
        const keyPair = await generateElectionKeyPair()

        publicKey = keyPair.publicKey
        privateKey = keyPair.privateKey
    })

    it("should generate a valid election key pair", () => {
        expect(publicKey).to.be.a("string")
        expect(privateKey).to.be.a("string")

        expect(publicKey).to.have.length(64)
        expect(privateKey).to.have.length(64)
    })

    it("should validate a matching election key pair", async () => {
        const isValid = await validateElectionKeyPair(publicKey, privateKey)

        expect(isValid).to.equal(true)
    })

    it("should reject a mismatched public and private key pair", async () => {
        const anotherKeyPair = await generateElectionKeyPair()

        const isValid = await validateElectionKeyPair(publicKey, anotherKeyPair.privateKey)

        expect(isValid).to.equal(false)
    })

    it("should encrypt and decrypt a ballot correctly", async () => {
        const ballot = "candidate:1"

        const ciphertext = await encryptBallot(ballot, publicKey)

        const decrypted = await decryptBallot(ciphertext, publicKey, privateKey)

        expect(decrypted).to.equal(ballot)
    })

    it("should produce different ciphertexts for identical ballots", async () => {
        const ballot = "candidate:1"

        const ciphertext1 = await encryptBallot(ballot, publicKey)
        const ciphertext2 = await encryptBallot(ballot, publicKey)

        expect(ciphertext1).to.not.equal(ciphertext2)
    })

    it("should reject decryption with the wrong private key", async () => {
        const ballot = "candidate:1"
        const ciphertext = await encryptBallot(ballot, publicKey)
        const wrongKeyPair = await generateElectionKeyPair()

        try {
            await decryptBallot(ciphertext, publicKey, wrongKeyPair.privateKey)

            expect.fail("Decryption should have failed.")
        } catch (error) {
            expect((error as Error).message).to.equal("Public and private keys do not form a pair.")
        }
    })

    it("should reject an empty ballot", async () => {
        try {
            await encryptBallot("", publicKey)
            expect.fail("Empty ballot should have been rejected.")
        } catch (error) {
            expect((error as Error).message).to.equal("Ballot must not be empty.")
        }
    })

    it("should reject an invalid public key", async () => {
        try {
            await encryptBallot("candidate:1", "invalid-key")
            expect.fail("Invalid public key should have been rejected.")
        } catch (error) {
            expect((error as Error).message).to.equal("Invalid public key encoding.")
        }
    })

    it("should reject malformed ciphertext", async () => {
        try {
            await decryptBallot("not-hex", publicKey, privateKey)
            expect.fail("Malformed ciphertext should have been rejected.")
        } catch (error) {
            expect((error as Error).message).to.equal("Invalid ciphertext encoding.")
        }
    })

    it("should reject ciphertext that is too short", async () => {
        try {
            await decryptBallot("aabb", publicKey, privateKey)
            expect.fail("Short ciphertext should have been rejected.")
        } catch (error) {
            expect((error as Error).message).to.equal("Invalid ciphertext length.")
        }
    })

    it("should reject decryption using another election's key pair", async () => {
        const ballot = "candidate:1"
        const ciphertext = await encryptBallot(ballot, publicKey)
        const anotherElectionKeyPair = await generateElectionKeyPair()

        try {
            await decryptBallot(ciphertext, anotherElectionKeyPair.publicKey, anotherElectionKeyPair.privateKey)

            expect.fail("Decryption with another election's keys should fail.")
        } catch (error) {
            expect((error as Error).message).to.equal("Ballot decryption failed.")
        }
    })
})
