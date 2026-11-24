
from fastapi import APIRouter, HTTPException, Path, status

from app.schemas.registration import RegistrationStatusResponse
from app.services.blockchain import (
    BlockchainConnectionError,
    blockchain_service,
)


router = APIRouter(
    prefix="/elections",
    tags=["Voter Registration"],
)


UINT256_MAX = (1 << 256) - 1


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
    """Verify that the requested election exists."""

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


def parse_commitment(commitment: str) -> int:
    """Validate and convert a decimal uint256 commitment."""

    if not commitment.isascii() or not commitment.isdecimal():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Commitment must be a decimal integer.",
        )

    try:
        value = int(commitment, 10)

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid identity commitment.",
        ) from exc

    if value < 1 or value > UINT256_MAX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Commitment must be a nonzero uint256 value.",
        )

    return value


@router.get(
    "/{election_id}/registration/{commitment}",
    response_model=RegistrationStatusResponse,
    summary="Check voter registration status",
)
def get_registration_status(
    election_id: int = Path(ge=1),
    commitment: str = Path(min_length=1, max_length=78),
) -> RegistrationStatusResponse:
    """
    Check whether an identity commitment is registered for an election.

    The commitment is supplied as a decimal string to preserve uint256
    precision across JSON and JavaScript clients.
    """

    contract = get_contract()

    validate_election_id(contract, election_id)

    commitment_value = parse_commitment(commitment)

    try:
        registered = contract.functions.registeredCommitments(
            election_id,
            commitment_value,
        ).call()

        if not isinstance(registered, bool):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Smart contract returned an invalid registration status.",
            )

        return RegistrationStatusResponse(
            election_id=election_id,
            commitment=str(commitment_value),
            registered=registered,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve registration status from blockchain.",
        ) from exc
