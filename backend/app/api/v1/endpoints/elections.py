
from fastapi import APIRouter, HTTPException, status

from app.schemas.election import (
    CandidateListResponse,
    CandidateResponse,
    CandidateResult,
    ElectionDetail,
    ElectionListResponse,
    ElectionResultsResponse,
    ElectionStatusResponse,
    ElectionSummary,
    ElectionVotingConfigResponse,
)
from app.services.blockchain import (
    BlockchainConnectionError,
    blockchain_service,
)


router = APIRouter(prefix="/elections", tags=["Elections"])


ELECTION_STATUSES = {
    0: "Registration",
    1: "Voting",
    2: "Closed",
    3: "Finalized",
}


def get_contract():
    """Return the initialized Voting contract."""

    try:
        return blockchain_service.get_voting_contract()

    except BlockchainConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voting contract is not initialized.",
        ) from exc


def validate_election_id(contract, election_id: int) -> None:
    """Check whether an election ID exists on the blockchain."""

    if election_id < 1:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found.",
        )

    try:
        next_election_id = contract.functions.nextElectionId().call()

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve election information from blockchain.",
        ) from exc

    if election_id >= next_election_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Election {election_id} does not exist.",
        )


def get_election_data(contract, election_id: int) -> tuple:
    """Retrieve and validate the election struct from the contract."""

    validate_election_id(contract, election_id)

    try:
        election = contract.functions.getElection(election_id).call()

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve election details from blockchain.",
        ) from exc

    if len(election) != 10:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected election data returned by the smart contract.",
        )

    return election


def get_status_name(status_value: int) -> str:
    """Convert the Solidity ElectionStatus enum into a readable string."""

    if status_value not in ELECTION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Smart contract returned an unknown election status.",
        )

    return ELECTION_STATUSES[status_value]


def build_election_summary(
    election_id: int,
    election: tuple,
) -> ElectionSummary:
    """Convert the Solidity Election struct into a public API response."""

    return ElectionSummary(
        election_id=election_id,
        title=election[0],
        admin=election[1],
        start_time=election[2],
        end_time=election[3],
        registered_voter_count=election[6],
        accepted_ballot_count=election[7],
        total_valid_votes=election[8],
        status=get_status_name(election[9]),
    )


@router.get(
    "",
    response_model=ElectionListResponse,
    summary="List all elections",
)
def list_elections() -> ElectionListResponse:
    """Retrieve all elections created by the Voting contract."""

    contract = get_contract()

    try:
        next_election_id = contract.functions.nextElectionId().call()

        elections = []

        for election_id in range(1, next_election_id):
            election = contract.functions.getElection(
                election_id
            ).call()

            elections.append(
                build_election_summary(election_id, election)
            )

        return ElectionListResponse(
            total_elections=len(elections),
            elections=elections,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve elections from blockchain.",
        ) from exc


@router.get(
    "/{election_id}",
    response_model=ElectionDetail,
    summary="Get election details",
)
def get_election(election_id: int) -> ElectionDetail:
    """Retrieve public details for one election."""

    contract = get_contract()
    election = get_election_data(contract, election_id)

    try:
        candidates = contract.functions.getCandidates(
            election_id
        ).call()

        summary = build_election_summary(election_id, election)

        return ElectionDetail(
            **summary.model_dump(),
            group_id=election[4],
            candidate_count=len(candidates),
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve election details.",
        ) from exc


@router.get(
    "/{election_id}/candidates",
    response_model=CandidateListResponse,
    summary="Get election candidates",
)
def list_candidates(election_id: int) -> CandidateListResponse:
    """Retrieve all candidates registered for an election."""

    contract = get_contract()
    validate_election_id(contract, election_id)

    try:
        candidates = contract.functions.getCandidates(
            election_id
        ).call()

        candidate_responses = [
            CandidateResponse(
                candidate_id=index + 1,
                name=candidate[0],
            )
            for index, candidate in enumerate(candidates)
        ]

        return CandidateListResponse(
            election_id=election_id,
            total_candidates=len(candidate_responses),
            candidates=candidate_responses,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve candidates from blockchain.",
        ) from exc


@router.get(
    "/{election_id}/status",
    response_model=ElectionStatusResponse,
    summary="Get election status",
)
def get_election_status(
    election_id: int,
) -> ElectionStatusResponse:
    """Retrieve the lifecycle status and public counters of an election."""

    contract = get_contract()
    election = get_election_data(contract, election_id)

    return ElectionStatusResponse(
        election_id=election_id,
        status=get_status_name(election[9]),
        start_time=election[2],
        end_time=election[3],
        registered_voter_count=election[6],
        accepted_ballot_count=election[7],
    )


@router.get(
    "/{election_id}/voting-config",
    response_model=ElectionVotingConfigResponse,
    summary="Get public voting configuration",
)
def get_voting_config(
    election_id: int,
) -> ElectionVotingConfigResponse:
    """Retrieve the public cryptographic configuration for an election."""

    contract = get_contract()
    election = get_election_data(contract, election_id)

    try:
        public_key = contract.functions.getElectionPublicKey(
            election_id
        ).call()

        public_key_published = len(public_key) > 0

        encryption_public_key = (
            "0x" + bytes(public_key).hex()
            if public_key_published
            else ""
        )

        return ElectionVotingConfigResponse(
            election_id=election_id,
            semaphore_group_id=election[4],
            semaphore_scope=election[5],
            encryption_public_key=encryption_public_key,
            public_key_published=public_key_published,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve voting configuration from blockchain.",
        ) from exc


@router.get(
    "/{election_id}/results",
    response_model=ElectionResultsResponse,
    summary="Get finalized election results",
)
def get_election_results(
    election_id: int,
) -> ElectionResultsResponse:
    """Retrieve candidate vote counts after election finalization."""

    contract = get_contract()
    election = get_election_data(contract, election_id)

    if election[9] != 3:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Election results are not available until finalization.",
        )

    try:
        candidates = contract.functions.getCandidates(
            election_id
        ).call()

        vote_counts, total_valid_votes = (
            contract.functions.getResults(election_id).call()
        )

        if len(candidates) != len(vote_counts):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Candidate and result counts do not match.",
            )

        results = [
            CandidateResult(
                candidate_id=index + 1,
                candidate_name=candidate[0],
                votes=vote_counts[index],
            )
            for index, candidate in enumerate(candidates)
        ]

        return ElectionResultsResponse(
            election_id=election_id,
            total_valid_votes=total_valid_votes,
            results=results,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve election results from blockchain.",
        ) from exc
