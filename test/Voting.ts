
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { Group, Identity, generateProof } from "@semaphore-protocol/core";
import { expect } from "chai";
import { hexlify, keccak256, toUtf8Bytes } from "ethers";
import { ethers, run } from "hardhat";
import { Voting } from "../typechain-types";

describe("Voting", () => {
    async function deployVotingFixture() {
        const [admin, other] = await ethers.getSigners();

        const { semaphore } = await run("deploy:semaphore", {
            logs: false
        });

        const VotingFactory = await ethers.getContractFactory("Voting");

        const voting = (await VotingFactory.deploy(
            await semaphore.getAddress()
        )) as unknown as Voting;

        await voting.waitForDeployment();

        return { admin, other, semaphore, voting };
    }

    async function createElectionFixture() {
        const fixture = await deployVotingFixture();

        const latestBlock = await ethers.provider.getBlock("latest");

        if (!latestBlock) {
            throw new Error("Could not retrieve latest block");
        }

        const startTime = BigInt(latestBlock.timestamp + 3600);
        const endTime = startTime + 3600n;
        const electionId = 1n;

        await fixture.voting.createElection(
            "University Election",
            startTime,
            endTime
        );

        return {
            ...fixture,
            electionId,
            startTime,
            endTime
        };
    }

    async function createPreparedElection() {
        const fixture = await createElectionFixture();

        await fixture.voting.addCandidate(
            fixture.electionId,
            "Candidate A"
        );

        await fixture.voting.addCandidate(
            fixture.electionId,
            "Candidate B"
        );

        const identities = [
            new Identity(),
            new Identity(),
            new Identity(),
            new Identity(),
            new Identity()
        ];

        const group = new Group();

        for (const identity of identities) {
            await fixture.voting.registerVoter(
                fixture.electionId,
                identity.commitment
            );

            group.addMember(identity.commitment);
        }

        const election = await fixture.voting.getElection(
            fixture.electionId
        );

        return {
            ...fixture,
            identities,
            group,
            election
        };
    }

    async function startPreparedElection() {
        const fixture = await createPreparedElection();

        await time.increaseTo(Number(fixture.startTime));

        await fixture.voting.startVoting(fixture.electionId);

        return fixture;
    }

    async function createBallotProof(
        identity: Identity,
        group: Group,
        encryptedBallot: string,
        scope: bigint
    ) {
        const message = BigInt(keccak256(encryptedBallot));

        return generateProof(
            identity,
            group,
            message,
            scope
        );
    }

    async function submitTestBallot(
        voting: Voting,
        electionId: bigint,
        identity: Identity,
        group: Group,
        scope: bigint,
        ballotText: string
    ) {
        const encryptedBallot = hexlify(
            toUtf8Bytes(ballotText)
        );

        const proof = await createBallotProof(
            identity,
            group,
            encryptedBallot,
            scope
        );

        const proofStruct = {
            merkleTreeDepth: proof.merkleTreeDepth,
            merkleTreeRoot: proof.merkleTreeRoot,
            nullifier: proof.nullifier,
            message: proof.message,
            scope: proof.scope,
            points: proof.points
        };

        await voting.submitBallot(
            electionId,
            encryptedBallot,
            proofStruct
        );

        return { encryptedBallot, proof };
    }

    describe("Election creation", () => {
        it("creates an election with its own Semaphore group and scope", async () => {
            const { voting, admin } = await loadFixture(
                deployVotingFixture
            );

            const latestBlock = await ethers.provider.getBlock("latest");

            if (!latestBlock) {
                throw new Error("Could not retrieve latest block");
            }

            const startTime = BigInt(latestBlock.timestamp + 3600);
            const endTime = startTime + 3600n;

            await expect(
                voting.createElection(
                    "University Election",
                    startTime,
                    endTime
                )
            ).to.emit(voting, "ElectionCreated");

            const election = await voting.getElection(1n);

            expect(election.admin).to.equal(admin.address);

            // Semaphore group ID 0 is valid.
            expect(election.groupId).to.be.a("bigint");

            expect(election.scope).to.be.greaterThan(0n);
            expect(election.status).to.equal(0n);
            expect(election.registeredVoterCount).to.equal(0n);
            expect(election.acceptedBallotCount).to.equal(0n);
        });

        it("creates separate groups and scopes for separate elections", async () => {
            const { voting } = await loadFixture(
                deployVotingFixture
            );

            const latestBlock = await ethers.provider.getBlock("latest");

            if (!latestBlock) {
                throw new Error("Could not retrieve latest block");
            }

            const startTime = BigInt(latestBlock.timestamp + 3600);
            const endTime = startTime + 3600n;

            await voting.createElection(
                "Election One",
                startTime,
                endTime
            );

            await voting.createElection(
                "Election Two",
                startTime,
                endTime
            );

            const first = await voting.getElection(1n);
            const second = await voting.getElection(2n);

            expect(first.groupId).not.to.equal(second.groupId);
            expect(first.scope).not.to.equal(second.scope);
        });

        it("rejects an empty election title", async () => {
            const { voting } = await loadFixture(
                deployVotingFixture
            );

            const latestBlock = await ethers.provider.getBlock("latest");

            if (!latestBlock) {
                throw new Error("Could not retrieve latest block");
            }

            const startTime = BigInt(latestBlock.timestamp + 3600);

            await expect(
                voting.createElection(
                    "",
                    startTime,
                    startTime + 3600n
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidElectionTime"
            );
        });

        it("rejects an election whose start time is in the past", async () => {
            const { voting } = await loadFixture(
                deployVotingFixture
            );

            const latestBlock = await ethers.provider.getBlock("latest");

            if (!latestBlock) {
                throw new Error("Could not retrieve latest block");
            }

            const startTime = BigInt(latestBlock.timestamp);
            const endTime = startTime + 3600n;

            await expect(
                voting.createElection(
                    "Invalid Election",
                    startTime,
                    endTime
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidElectionTime"
            );
        });

        it("rejects an end time that is not after the start time", async () => {
            const { voting } = await loadFixture(
                deployVotingFixture
            );

            const latestBlock = await ethers.provider.getBlock("latest");

            if (!latestBlock) {
                throw new Error("Could not retrieve latest block");
            }

            const startTime = BigInt(latestBlock.timestamp + 3600);

            await expect(
                voting.createElection(
                    "Invalid Duration",
                    startTime,
                    startTime
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidElectionTime"
            );
        });
    });

    describe("Candidate management", () => {
        it("allows the administrator to add candidates", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            await expect(
                voting.addCandidate(electionId, "Candidate A")
            ).to.emit(voting, "CandidateAdded");

            const candidates = await voting.getCandidates(electionId);

            expect(candidates.length).to.equal(1);
            expect(candidates[0].name).to.equal("Candidate A");
        });

        it("allows multiple candidates to be added", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            await voting.addCandidate(electionId, "Candidate A");
            await voting.addCandidate(electionId, "Candidate B");

            const candidates = await voting.getCandidates(electionId);

            expect(candidates.length).to.equal(2);
            expect(candidates[0].name).to.equal("Candidate A");
            expect(candidates[1].name).to.equal("Candidate B");
        });

        it("rejects candidate creation by an unauthorized account", async () => {
            const { voting, electionId, other } = await loadFixture(
                createElectionFixture
            );

            await expect(
                voting.connect(other).addCandidate(
                    electionId,
                    "Candidate X"
                )
            ).to.be.revertedWithCustomError(
                voting,
                "Unauthorized"
            );
        });

        it("rejects an empty candidate name", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            await expect(
                voting.addCandidate(electionId, "")
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidCandidate"
            );
        });
    });

    describe("Voter registration", () => {
        it("registers a voter commitment", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            const identity = new Identity();

            await expect(
                voting.registerVoter(
                    electionId,
                    identity.commitment
                )
            ).to.emit(voting, "VoterRegistered");

            expect(
                await voting.registeredCommitments(
                    electionId,
                    identity.commitment
                )
            ).to.equal(true);

            const election = await voting.getElection(electionId);

            expect(election.registeredVoterCount).to.equal(1n);
        });

        it("rejects duplicate identity commitments", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            const identity = new Identity();

            await voting.registerVoter(
                electionId,
                identity.commitment
            );

            await expect(
                voting.registerVoter(
                    electionId,
                    identity.commitment
                )
            ).to.be.revertedWithCustomError(
                voting,
                "DuplicateCommitment"
            );
        });

        it("rejects a zero identity commitment", async () => {
            const { voting, electionId } = await loadFixture(
                createElectionFixture
            );

            await expect(
                voting.registerVoter(electionId, 0n)
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidCommitment"
            );
        });

        it("rejects voter registration by an unauthorized account", async () => {
            const { voting, electionId, other } = await loadFixture(
                createElectionFixture
            );

            const identity = new Identity();

            await expect(
                voting.connect(other).registerVoter(
                    electionId,
                    identity.commitment
                )
            ).to.be.revertedWithCustomError(
                voting,
                "Unauthorized"
            );
        });
    });

    describe("Voting lifecycle", () => {
        it("rejects starting an election before its start time", async () => {
            const { voting, electionId } = await loadFixture(
                createPreparedElection
            );

            await expect(
                voting.startVoting(electionId)
            ).to.be.revertedWithCustomError(
                voting,
                "ElectionNotStarted"
            );
        });

        it("rejects starting an election with insufficient candidates", async () => {
            const { voting, electionId, startTime } =
                await loadFixture(createElectionFixture);

            // Only one candidate.
            await voting.addCandidate(electionId, "Candidate A");

            // Register the required three voters.
            for (let i = 0; i < 3; i += 1) {
                const identity = new Identity();

                await voting.registerVoter(
                    electionId,
                    identity.commitment
                );
            }

            await time.increaseTo(Number(startTime));

            await expect(
                voting.startVoting(electionId)
            ).to.be.revertedWithCustomError(
                voting,
                "InsufficientCandidates"
            );
        });

        it("rejects starting an election with insufficient registered voters", async () => {
            const { voting, electionId, startTime } =
                await loadFixture(createElectionFixture);

            await voting.addCandidate(electionId, "Candidate A");
            await voting.addCandidate(electionId, "Candidate B");

            // Only two voters, while the contract requires three.
            for (let i = 0; i < 2; i += 1) {
                const identity = new Identity();

                await voting.registerVoter(
                    electionId,
                    identity.commitment
                );
            }

            await time.increaseTo(Number(startTime));

            await expect(
                voting.startVoting(electionId)
            ).to.be.revertedWithCustomError(
                voting,
                "InsufficientVoters"
            );
        });

        it("starts an election after its start time", async () => {
            const { voting, electionId, startTime } =
                await loadFixture(createPreparedElection);

            await time.increaseTo(Number(startTime));

            await expect(
                voting.startVoting(electionId)
            ).to.emit(voting, "VotingStarted");

            const election = await voting.getElection(electionId);

            expect(election.status).to.equal(1n);
        });
    });

    describe("Anonymous ballot submission", () => {
        it("accepts a valid Semaphore proof and stores the encrypted ballot", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                election,
                identities,
                group
            } = fixture;

            const { encryptedBallot } = await submitTestBallot(
                voting,
                electionId,
                identities[0],
                group,
                election.scope,
                "test-ballot-one"
            );

            const updatedElection = await voting.getElection(
                electionId
            );

            expect(updatedElection.acceptedBallotCount).to.equal(1n);

            const storedBallots = await voting.getEncryptedBallots(
                electionId
            );

            expect(storedBallots.length).to.equal(1);
            expect(storedBallots[0]).to.equal(encryptedBallot);
        });

        it("rejects reuse of the same Semaphore nullifier", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                election,
                identities,
                group
            } = fixture;

            const encryptedBallot = hexlify(
                toUtf8Bytes("duplicate-test-ballot")
            );

            const proof = await createBallotProof(
                identities[0],
                group,
                encryptedBallot,
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

            await voting.submitBallot(
                electionId,
                encryptedBallot,
                proofStruct
            );

            await expect(
                voting.submitBallot(
                    electionId,
                    encryptedBallot,
                    proofStruct
                )
            ).to.be.reverted;
        });

        it("rejects a proof with the wrong election scope", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                election,
                identities,
                group
            } = fixture;

            const encryptedBallot = hexlify(
                toUtf8Bytes("wrong-scope-ballot")
            );

            const proof = await createBallotProof(
                identities[0],
                group,
                encryptedBallot,
                election.scope + 1n
            );

            await expect(
                voting.submitBallot(
                    electionId,
                    encryptedBallot,
                    {
                        merkleTreeDepth: proof.merkleTreeDepth,
                        merkleTreeRoot: proof.merkleTreeRoot,
                        nullifier: proof.nullifier,
                        message: proof.message,
                        scope: proof.scope,
                        points: proof.points
                    }
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidProofScope"
            );
        });

        it("rejects a modified ciphertext", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                election,
                identities,
                group
            } = fixture;

            const originalBallot = hexlify(
                toUtf8Bytes("original-ballot")
            );

            const modifiedBallot = hexlify(
                toUtf8Bytes("modified-ballot")
            );

            const proof = await createBallotProof(
                identities[0],
                group,
                originalBallot,
                election.scope
            );

            await expect(
                voting.submitBallot(
                    electionId,
                    modifiedBallot,
                    {
                        merkleTreeDepth: proof.merkleTreeDepth,
                        merkleTreeRoot: proof.merkleTreeRoot,
                        nullifier: proof.nullifier,
                        message: proof.message,
                        scope: proof.scope,
                        points: proof.points
                    }
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidBallotCommitment"
            );
        });

        it("rejects an empty encrypted ballot", async () => {
            const { voting, electionId } = await loadFixture(
                startPreparedElection
            );

            const dummyProof = {
                merkleTreeDepth: 1,
                merkleTreeRoot: 0n,
                nullifier: 0n,
                message: 0n,
                scope: 0n,
                points: [
                    0n, 0n, 0n, 0n,
                    0n, 0n, 0n, 0n
                ] as [
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint
                ]
            };

            await expect(
                voting.submitBallot(
                    electionId,
                    "0x",
                    dummyProof
                )
            ).to.be.revertedWithCustomError(
                voting,
                "EmptyEncryptedBallot"
            );
        });
    });

    describe("Election closing and tally", () => {
        it("rejects closing an election before its deadline", async () => {
            const { voting, electionId } = await loadFixture(
                startPreparedElection
            );

            await expect(
                voting.closeElection(electionId)
            ).to.be.revertedWithCustomError(
                voting,
                "ElectionDeadlineNotReached"
            );
        });

        it("closes an election after its deadline", async () => {
            const { voting, electionId, endTime } =
                await loadFixture(startPreparedElection);

            await time.increaseTo(Number(endTime));

            await expect(
                voting.closeElection(electionId)
            ).to.emit(voting, "ElectionClosed");

            const election = await voting.getElection(electionId);

            expect(election.status).to.equal(2n);
        });

        it("rejects results before finalization", async () => {
            const { voting, electionId } = await loadFixture(
                createPreparedElection
            );

            await expect(
                voting.getResults(electionId)
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidElectionStatus"
            );
        });

        it("finalizes a tally consistent with accepted ballots", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                endTime,
                election,
                identities,
                group
            } = fixture;

            // Submit five valid ballots using five distinct identities.
            for (let i = 0; i < 5; i += 1) {
                await submitTestBallot(
                    voting,
                    electionId,
                    identities[i],
                    group,
                    election.scope,
                    `test-ballot-${i}`
                );
            }

            const updatedElection = await voting.getElection(
                electionId
            );

            expect(updatedElection.acceptedBallotCount).to.equal(5n);

            await time.increaseTo(Number(endTime));

            await voting.closeElection(electionId);

            // The tally total is 5, matching the five accepted ballots.
            await expect(
                voting.finalizeElection(
                    electionId,
                    [3n, 2n]
                )
            ).to.emit(voting, "ElectionFinalized")
                .withArgs(electionId, 5n);

            const [results, totalVotes] = await voting.getResults(
                electionId
            );

            expect(results[0]).to.equal(3n);
            expect(results[1]).to.equal(2n);
            expect(totalVotes).to.equal(5n);

            const finalizedElection = await voting.getElection(
                electionId
            );

            expect(finalizedElection.status).to.equal(3n);
        });

        it("rejects a tally whose total exceeds accepted ballots", async () => {
            const { voting, electionId, endTime } =
                await loadFixture(startPreparedElection);

            // No ballots are submitted.
            await time.increaseTo(Number(endTime));

            await voting.closeElection(electionId);

            await expect(
                voting.finalizeElection(
                    electionId,
                    [1n, 1n]
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidTallyTotal"
            );
        });

        it("rejects a tally with the wrong number of candidates", async () => {
            const { voting, electionId, endTime } =
                await loadFixture(startPreparedElection);

            await time.increaseTo(Number(endTime));

            await voting.closeElection(electionId);

            await expect(
                voting.finalizeElection(
                    electionId,
                    [0n]
                )
            ).to.be.revertedWithCustomError(
                voting,
                "InvalidTallyLength"
            );
        });

        it("rejects tally finalization by an unauthorized account", async () => {
            const {
                voting,
                electionId,
                endTime,
                other
            } = await loadFixture(startPreparedElection);

            await time.increaseTo(Number(endTime));

            await voting.closeElection(electionId);

            await expect(
                voting.connect(other).finalizeElection(
                    electionId,
                    [0n, 0n]
                )
            ).to.be.revertedWithCustomError(
                voting,
                "Unauthorized"
            );
        });

        it("returns individual candidate vote counts after finalization", async () => {
            const fixture = await loadFixture(
                startPreparedElection
            );

            const {
                voting,
                electionId,
                endTime,
                election,
                identities,
                group
            } = fixture;

            // Five accepted ballots are required for a 3-2 tally.
            for (let i = 0; i < 5; i += 1) {
                await submitTestBallot(
                    voting,
                    electionId,
                    identities[i],
                    group,
                    election.scope,
                    `candidate-count-ballot-${i}`
                );
            }

            const updatedElection = await voting.getElection(
                electionId
            );

            expect(updatedElection.acceptedBallotCount).to.equal(5n);

            await time.increaseTo(Number(endTime));

            await voting.closeElection(electionId);

            await voting.finalizeElection(
                electionId,
                [3n, 2n]
            );

            expect(
                await voting.getCandidateVoteCount(
                    electionId,
                    1n
                )
            ).to.equal(3n);

            expect(
                await voting.getCandidateVoteCount(
                    electionId,
                    2n
                )
            ).to.equal(2n);
        });
    });
});
