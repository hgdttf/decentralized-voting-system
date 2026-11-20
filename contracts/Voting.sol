
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract Voting {
    // --------------------------------------------------
    // Constants and types
    // --------------------------------------------------

    uint256 public constant MIN_REGISTERED_VOTERS = 3;
    uint256 public constant MERKLE_TREE_DURATION = 1 days;

    enum ElectionStatus {
        Registration,
        Voting,
        Closed,
        Finalized
    }

    struct Candidate {
        string name;
    }

    struct Election {
        string title;
        address admin;
        uint64 startTime;
        uint64 endTime;
        uint256 groupId;
        uint256 scope;
        uint256 registeredVoterCount;
        uint256 acceptedBallotCount;
        uint256 totalValidVotes;
        ElectionStatus status;
    }

    // --------------------------------------------------
    // State
    // --------------------------------------------------

    ISemaphore public immutable semaphore;

    uint256 public nextElectionId = 1;

    mapping(uint256 => Election) private elections;

    mapping(uint256 => Candidate[]) private candidates;

    mapping(uint256 => mapping(uint256 => bool))
        public registeredCommitments;

    mapping(uint256 => bytes[]) private encryptedBallots;

    mapping(uint256 => mapping(uint256 => uint256))
        private candidateVoteCounts;

    // --------------------------------------------------
    // Errors
    // --------------------------------------------------

    error InvalidSemaphoreAddress();
    error InvalidElection();
    error Unauthorized();
    error InvalidElectionTime();
    error InvalidElectionStatus();
    error InvalidCandidate();
    error DuplicateCommitment();
    error InvalidCommitment();
    error InsufficientVoters();
    error InsufficientCandidates();
    error ElectionNotStarted();
    error ElectionDeadlineNotReached();
    error EmptyEncryptedBallot();
    error InvalidProofScope();
    error InvalidBallotCommitment();
    error InvalidTallyLength();
    error InvalidTallyTotal();

    // --------------------------------------------------
    // Events
    // --------------------------------------------------

    event ElectionCreated(
        uint256 indexed electionId,
        address indexed admin,
        uint256 indexed groupId,
        uint256 scope
    );

    event CandidateAdded(
        uint256 indexed electionId,
        uint256 candidateId,
        string name
    );

    event VoterRegistered(
        uint256 indexed electionId,
        uint256 registeredVoterCount
    );

    event VotingStarted(uint256 indexed electionId);

    event EncryptedBallotSubmitted(
        uint256 indexed electionId,
        uint256 ballotIndex,
        uint256 nullifier,
        bytes32 ballotCommitment
    );

    event ElectionClosed(uint256 indexed electionId);

    event ElectionFinalized(
        uint256 indexed electionId,
        uint256 totalValidVotes
    );

    // --------------------------------------------------
    // Constructor
    // --------------------------------------------------

    constructor(address semaphoreAddress) {
        if (semaphoreAddress == address(0)) {
            revert InvalidSemaphoreAddress();
        }

        semaphore = ISemaphore(semaphoreAddress);
    }

    // --------------------------------------------------
    // Modifiers
    // --------------------------------------------------

    modifier onlyElectionAdmin(uint256 electionId) {
        if (elections[electionId].admin != msg.sender) {
            revert Unauthorized();
        }

        _;
    }

    modifier electionExists(uint256 electionId) {
        if (elections[electionId].admin == address(0)) {
            revert InvalidElection();
        }

        _;
    }

    // --------------------------------------------------
    // Election management
    // --------------------------------------------------

    function createElection(
        string calldata title,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 electionId) {
        if (
            bytes(title).length == 0 ||
            startTime <= block.timestamp ||
            endTime <= startTime
        ) {
            revert InvalidElectionTime();
        }

        electionId = nextElectionId++;

        // The Voting contract becomes the Semaphore group admin.
        uint256 groupId = semaphore.createGroup(
            address(this),
            MERKLE_TREE_DURATION
        );

        // Bind the proof to this contract, chain and election.
        uint256 scope = uint256(
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    electionId
                )
            )
        );

        elections[electionId] = Election({
            title: title,
            admin: msg.sender,
            startTime: startTime,
            endTime: endTime,
            groupId: groupId,
            scope: scope,
            registeredVoterCount: 0,
            acceptedBallotCount: 0,
            totalValidVotes: 0,
            status: ElectionStatus.Registration
        });

        emit ElectionCreated(
            electionId,
            msg.sender,
            groupId,
            scope
        );
    }

    function addCandidate(
        uint256 electionId,
        string calldata candidateName
    )
        external
        electionExists(electionId)
        onlyElectionAdmin(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Registration) {
            revert InvalidElectionStatus();
        }

        if (bytes(candidateName).length == 0) {
            revert InvalidCandidate();
        }

        candidates[electionId].push(
            Candidate({name: candidateName})
        );

        emit CandidateAdded(
            electionId,
            candidates[electionId].length,
            candidateName
        );
    }

    // --------------------------------------------------
    // Voter registration
    // --------------------------------------------------

    function registerVoter(
        uint256 electionId,
        uint256 identityCommitment
    )
        external
        electionExists(electionId)
        onlyElectionAdmin(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Registration) {
            revert InvalidElectionStatus();
        }

        if (identityCommitment == 0) {
            revert InvalidCommitment();
        }

        if (registeredCommitments[electionId][identityCommitment]) {
            revert DuplicateCommitment();
        }

        registeredCommitments[electionId][identityCommitment] = true;

        semaphore.addMember(
            election.groupId,
            identityCommitment
        );

        election.registeredVoterCount++;

        emit VoterRegistered(
            electionId,
            election.registeredVoterCount
        );
    }

    // --------------------------------------------------
    // Voting lifecycle
    // --------------------------------------------------

    function startVoting(uint256 electionId)
        external
        electionExists(electionId)
        onlyElectionAdmin(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Registration) {
            revert InvalidElectionStatus();
        }

        if (block.timestamp < election.startTime) {
            revert ElectionNotStarted();
        }

        if (block.timestamp >= election.endTime) {
            revert ElectionDeadlineNotReached();
        }

        if (candidates[electionId].length < 2) {
            revert InsufficientCandidates();
        }

        if (
            election.registeredVoterCount <
            MIN_REGISTERED_VOTERS
        ) {
            revert InsufficientVoters();
        }

        election.status = ElectionStatus.Voting;

        emit VotingStarted(electionId);
    }

    function submitBallot(
        uint256 electionId,
        bytes calldata encryptedBallot,
        ISemaphore.SemaphoreProof calldata proof
    )
        external
        electionExists(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Voting) {
            revert InvalidElectionStatus();
        }

        if (
            block.timestamp < election.startTime ||
            block.timestamp >= election.endTime
        ) {
            revert ElectionDeadlineNotReached();
        }

        if (encryptedBallot.length == 0) {
            revert EmptyEncryptedBallot();
        }

        // Ensure the proof belongs to this election.
        if (proof.scope != election.scope) {
            revert InvalidProofScope();
        }

        // Bind the proof message to the exact ciphertext.
        uint256 expectedMessage = uint256(
            keccak256(encryptedBallot)
        );

        if (proof.message != expectedMessage) {
            revert InvalidBallotCommitment();
        }

        // Semaphore verifies membership and consumes the nullifier.
        semaphore.validateProof(election.groupId, proof);

        uint256 ballotIndex = encryptedBallots[electionId].length;

        encryptedBallots[electionId].push(encryptedBallot);

        election.acceptedBallotCount++;

        emit EncryptedBallotSubmitted(
            electionId,
            ballotIndex,
            proof.nullifier,
            keccak256(encryptedBallot)
        );
    }

    function closeElection(uint256 electionId)
        external
        electionExists(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Voting) {
            revert InvalidElectionStatus();
        }

        if (block.timestamp < election.endTime) {
            revert ElectionDeadlineNotReached();
        }

        election.status = ElectionStatus.Closed;

        emit ElectionClosed(electionId);
    }

    // --------------------------------------------------
    // Tally finalization
    // --------------------------------------------------

    function finalizeElection(
        uint256 electionId,
        uint256[] calldata voteCounts
    )
        external
        electionExists(electionId)
        onlyElectionAdmin(electionId)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Closed) {
            revert InvalidElectionStatus();
        }

        uint256 candidateCount = candidates[electionId].length;

        if (voteCounts.length != candidateCount) {
            revert InvalidTallyLength();
        }

        uint256 totalVotes = 0;

        for (uint256 i = 0; i < candidateCount; i++) {
            candidateVoteCounts[electionId][i + 1] = voteCounts[i];
            totalVotes += voteCounts[i];
        }

        if (totalVotes > election.acceptedBallotCount) {
            revert InvalidTallyTotal();
        }

        election.totalValidVotes = totalVotes;
        election.status = ElectionStatus.Finalized;

        emit ElectionFinalized(electionId, totalVotes);
    }

    // --------------------------------------------------
    // Read functions
    // --------------------------------------------------

    function getElection(
        uint256 electionId
    )
        external
        view
        electionExists(electionId)
        returns (Election memory)
    {
        return elections[electionId];
    }

    function getCandidates(
        uint256 electionId
    )
        external
        view
        electionExists(electionId)
        returns (Candidate[] memory)
    {
        return candidates[electionId];
    }

    function getEncryptedBallots(
        uint256 electionId
    )
        external
        view
        electionExists(electionId)
        returns (bytes[] memory)
    {
        return encryptedBallots[electionId];
    }

    function getCandidateVoteCount(
        uint256 electionId,
        uint256 candidateId
    )
        external
        view
        electionExists(electionId)
        returns (uint256)
    {
        if (elections[electionId].status != ElectionStatus.Finalized) {
            revert InvalidElectionStatus();
        }

        if (
            candidateId == 0 ||
            candidateId > candidates[electionId].length
        ) {
            revert InvalidCandidate();
        }

        return candidateVoteCounts[electionId][candidateId];
    }

    function getResults(
        uint256 electionId
    )
        external
        view
        electionExists(electionId)
        returns (uint256[] memory results, uint256 totalValidVotes)
    {
        Election storage election = elections[electionId];

        if (election.status != ElectionStatus.Finalized) {
            revert InvalidElectionStatus();
        }

        uint256 candidateCount = candidates[electionId].length;

        results = new uint256[](candidateCount);

        for (uint256 i = 0; i < candidateCount; i++) {
            results[i] = candidateVoteCounts[electionId][i + 1];
        }

        totalValidVotes = election.totalValidVotes;
    }
}
