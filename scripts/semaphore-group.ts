
import { Group } from "@semaphore-protocol/core";
import { Contract, Provider } from "ethers";

const SEMAPHORE_GROUPS_ABI = [
    "event MemberAdded(uint256 indexed groupId, uint256 index, uint256 identityCommitment, uint256 merkleTreeRoot)",
    "event MemberRemoved(uint256 indexed groupId, uint256 index, uint256 identityCommitment, uint256 merkleTreeRoot)",
    "event MemberUpdated(uint256 indexed groupId, uint256 index, uint256 oldIdentityCommitment, uint256 newIdentityCommitment, uint256 merkleTreeRoot)",
    "event MembersAdded(uint256 indexed groupId, uint256 index, uint256[] identityCommitments, uint256 merkleTreeRoot)",
    "function getMerkleTreeRoot(uint256 groupId) view returns (uint256)",
    "function getMerkleTreeDepth(uint256 groupId) view returns (uint256)",
    "function getMerkleTreeSize(uint256 groupId) view returns (uint256)"
];

export interface ReconstructedSemaphoreGroup {
    group: Group;
    memberCount: number;
    root: bigint;
    depth: number;
}

export async function reconstructSemaphoreGroup(
    provider: Provider,
    semaphoreAddress: string,
    groupId: bigint,
    fromBlock = 0
): Promise<ReconstructedSemaphoreGroup> {
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new Error("Invalid starting block.");
    }

    const semaphore = new Contract(
        semaphoreAddress,
        SEMAPHORE_GROUPS_ABI,
        provider
    );

    const [addedEvents, removedEvents, updatedEvents, batchAddedEvents] =
        await Promise.all([
            semaphore.queryFilter(
                semaphore.filters.MemberAdded(groupId),
                fromBlock
            ),
            semaphore.queryFilter(
                semaphore.filters.MemberRemoved(groupId),
                fromBlock
            ),
            semaphore.queryFilter(
                semaphore.filters.MemberUpdated(groupId),
                fromBlock
            ),
            semaphore.queryFilter(
                semaphore.filters.MembersAdded(groupId),
                fromBlock
            )
        ]);

    if (
        removedEvents.length > 0 ||
        updatedEvents.length > 0 ||
        batchAddedEvents.length > 0
    ) {
        throw new Error(
            "Unsupported Semaphore membership mutation detected. " +
            "Only individual MemberAdded events are supported."
        );
    }

    const events = addedEvents
        .filter((event) => "args" in event)
        .sort((a, b) => {
            if (a.blockNumber !== b.blockNumber) {
                return a.blockNumber - b.blockNumber;
            }

            return a.index - b.index;
        });

    const commitments: bigint[] = [];
    let latestEventRoot = 0n;

    for (const event of events) {
        if (!("args" in event)) {
            throw new Error("Unable to decode a Semaphore MemberAdded event.");
        }

        const index = BigInt(event.args.index);
        const commitment = BigInt(event.args.identityCommitment);

        if (index !== BigInt(commitments.length)) {
            throw new Error(
                `Unexpected member index ${index}; expected ${commitments.length}.`
            );
        }

        if (commitment === 0n) {
            throw new Error("Semaphore identity commitment cannot be zero.");
        }

        commitments.push(commitment);
        latestEventRoot = BigInt(event.args.merkleTreeRoot);
    }

    const group = new Group(commitments);

    if (group.root !== latestEventRoot) {
        throw new Error(
            `Event root mismatch. Local: ${group.root}; event: ${latestEventRoot}.`
        );
    }

    const [chainRoot, chainDepth, chainSize] = await Promise.all([
        semaphore.getMerkleTreeRoot(groupId),
        semaphore.getMerkleTreeDepth(groupId),
        semaphore.getMerkleTreeSize(groupId)
    ]);

    if (group.root !== BigInt(chainRoot)) {
        throw new Error(
            `On-chain root mismatch. Local: ${group.root}; chain: ${chainRoot}.`
        );
    }

    if (group.depth !== Number(chainDepth)) {
        throw new Error(
            `On-chain depth mismatch. Local: ${group.depth}; chain: ${chainDepth}.`
        );
    }

    if (group.size !== Number(chainSize)) {
        throw new Error(
            `On-chain size mismatch. Local: ${group.size}; chain: ${chainSize}.`
        );
    }

    return {
        group,
        memberCount: group.size,
        root: group.root,
        depth: group.depth
    };
}
