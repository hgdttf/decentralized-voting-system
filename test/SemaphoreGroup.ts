import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { Identity, generateProof } from "@semaphore-protocol/core";
import { expect } from "chai";
import { Contract, keccak256 } from "ethers";
import { ethers, run } from "hardhat";
import { Voting } from "../typechain-types";
import {
    encryptBallot,
    generateElectionKeyPair
} from "../scripts/ballot-crypto";
import { reconstructSemaphoreGroup } from "../scripts/semaphore-group";

describe("Semaphore Group Reconstruction Integration", () => {
    it("reconstructs the on-chain group and submits an encrypted ballot using the reconstructed group", async () => {
        // 1. Deploy Semaphore.
        const { semaphore } = await run("deploy:semaphore", { logs: false });
        const semaphoreAddress = await semaphore.getAddress();

        // 2. Deploy Voting.
        const VotingFactory = await ethers.getContractFactory("Voting");

        const voting = (
            await VotingFactory.deploy(semaphoreAddress)
        ) as unknown as Voting;

        await voting.waitForDeployment();

        // 3. Create election.
        const latestBlock = await ethers.provider.getBlock("latest");

        if (!latestBlock) {
            throw new Error("Could not retrieve latest block.");
        }

        const electionId = 1n;
        const startTime = BigInt(latestBlock.timestamp + 3600);
        const endTime = startTime + 3600n;

        await voting.createElection(
            "Semaphore Reconstruction Test",
            startTime,
            endTime
        );

        // 4. Add candidates.
        await voting.addCandidate(electionId, "Candidate A");
        await voting.addCandidate(electionId, "Candidate B");

        // 5. Create and register five voter identities.
        const identities = Array.from(
            { length: 5 },
            () => new Identity()
        );

        for (const identity of identities) {
            await voting.registerVoter(
                electionId,
                identity.commitment
            );
        }

        const election = await voting.getElection(electionId);

        // 6. Reconstruct Semaphore group from blockchain events.
        const reconstructed = await reconstructSemaphoreGroup(
            ethers.provider,
            semaphoreAddress,
            election.groupId
        );

        // 7. Verify reconstructed group against on-chain state.
        expect(reconstructed.memberCount).to.equal(5);
        expect(reconstructed.group.size).to.equal(5);

        const semaphoreContract = new Contract(
            semaphoreAddress,
            [
                "function getMerkleTreeRoot(uint256 groupId) view returns (uint256)",
                "function getMerkleTreeDepth(uint256 groupId) view returns (uint256)",
                "function getMerkleTreeSize(uint256 groupId) view returns (uint256)"
            ],
            ethers.provider
        );

        const [
            chainRoot,
            chainDepth,
            chainSize
        ] = await Promise.all([
            semaphoreContract.getMerkleTreeRoot(election.groupId),
            semaphoreContract.getMerkleTreeDepth(election.groupId),
            semaphoreContract.getMerkleTreeSize(election.groupId)
        ]);

        expect(reconstructed.root).to.equal(BigInt(chainRoot));
        expect(reconstructed.depth).to.equal(Number(chainDepth));
        expect(reconstructed.memberCount).to.equal(Number(chainSize));

        // 8. Generate and publish the election public key BEFORE voting starts.
        const electionKeys = await generateElectionKeyPair();

        await voting.setElectionPublicKey(
            electionId,
            `0x${electionKeys.publicKey}`
        );

        // 9. Start election.
        await time.increaseTo(Number(startTime));

        await voting.startVoting(electionId);

        // 10. Encrypt a ballot using the published election public key.
        const ciphertext = await encryptBallot(
            "Candidate A",
            electionKeys.publicKey
        );

        const encryptedBallot = `0x${ciphertext}`;

        // 11. Generate Semaphore proof using the reconstructed group.
        const voterIdentity = identities[0];

        const message = BigInt(
            keccak256(encryptedBallot)
        );

        const proof = await generateProof(
            voterIdentity,
            reconstructed.group,
            message,
            election.scope
        );

        const proofStruct = {
            merkleTreeDepth: proof.merkleTreeDepth,
            merkleTreeRoot: proof.merkleTreeRoot,
            nullifier: proof.nullifier,
            message: proof.message,
            scope: proof.scope,
            points: proof.points
        };

        // 12. Submit encrypted ballot.
        await expect(
            voting.submitBallot(
                electionId,
                encryptedBallot,
                proofStruct
            )
        ).to.emit(voting, "EncryptedBallotSubmitted");

        // 13. Verify ballot acceptance and ciphertext storage.
        const updatedElection = await voting.getElection(electionId);

        expect(updatedElection.acceptedBallotCount).to.equal(1n);

        const storedBallots = await voting.getEncryptedBallots(electionId);

        expect(storedBallots).to.have.length(1);
        expect(storedBallots[0]).to.equal(encryptedBallot);
    });
});