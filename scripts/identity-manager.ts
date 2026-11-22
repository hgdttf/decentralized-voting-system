import { Identity } from "@semaphore-protocol/core";

export interface VoterIdentity {
    identity: Identity;
    commitment: string;
}

/**
 * Generates a new Semaphore identity for a voter.
 * The private identity is never sent to the blockchain.
 */
export function createVoterIdentity(): VoterIdentity {
    const identity = new Identity();

    return {
        identity,
        commitment: identity.commitment.toString()
    };
}

/**
 * Restores a previously exported Semaphore identity.
 */
export function restoreVoterIdentity(exportedIdentity: string): VoterIdentity {
    if (typeof exportedIdentity !== "string" || exportedIdentity.length === 0) {
        throw new Error("Invalid exported identity.");
    }

    const identity = Identity.import(exportedIdentity);

    return {
        identity,
        commitment: identity.commitment.toString()
    };
}

/**
 * Exports the identity in Semaphore's base64 format.
 * This value is sensitive and must be encrypted before storage.
 */
export function exportVoterIdentity(identity: Identity): string {
    if (!(identity instanceof Identity)) {
        throw new Error("A valid Semaphore identity is required.");
    }

    return identity.export();
}
