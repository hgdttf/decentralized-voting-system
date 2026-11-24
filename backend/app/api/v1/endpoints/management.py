
import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.config import settings
from app.schemas.management import (
    AddCandidateRequest,
    CreateElectionRequest,
    ElectionOperationResponse,
    RegisterVoterRequest,
    SubmitBallotRequest,
)
from app.services.bridge import bridge_service


router = APIRouter(
    prefix="/elections",
    tags=["Election Management"],
)


def require_admin(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    configured_token = settings.admin_api_token

    if not configured_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrative API authentication is not configured.",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid administrative bearer token is required.",
        )

    supplied_token = authorization.removeprefix("Bearer ").strip()

    if not hmac.compare_digest(supplied_token, configured_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid administrative token.",
        )


AdminRequired = Annotated[None, Depends(require_admin)]


def execute_admin_operation(
    action: str,
    payload: dict,
) -> ElectionOperationResponse:
    result = bridge_service.execute(action, payload)

    return ElectionOperationResponse(
        success=True,
        message="Blockchain operation completed successfully.",
        data=result if isinstance(result, (dict, list, str, int)) else None,
    )


@router.post(
    "",
    response_model=ElectionOperationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_election(
    request: CreateElectionRequest,
    _: AdminRequired,
):
    return execute_admin_operation(
        "create_election",
        {
            "title": request.title,
            "start_time": request.start_time,
            "end_time": request.end_time,
            "candidates": request.candidates,
        },
    )


@router.post(
    "/{election_id}/candidates",
    response_model=ElectionOperationResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_candidate(
    election_id: int,
    request: AddCandidateRequest,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "add_candidate",
        {
            "election_id": election_id,
            "name": request.name,
        },
    )


@router.post(
    "/{election_id}/voters",
    response_model=ElectionOperationResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_voter(
    election_id: int,
    request: RegisterVoterRequest,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "register_voter",
        {
            "election_id": election_id,
            "commitment": request.commitment,
        },
    )


@router.post(
    "/{election_id}/publish-key",
    response_model=ElectionOperationResponse,
)
def publish_election_key(
    election_id: int,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "publish_election_key",
        {"election_id": election_id},
    )


@router.post(
    "/{election_id}/start",
    response_model=ElectionOperationResponse,
)
def start_voting(
    election_id: int,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "start_voting",
        {"election_id": election_id},
    )


@router.post(
    "/{election_id}/ballots",
    response_model=ElectionOperationResponse,
    status_code=status.HTTP_201_CREATED,
)
def submit_ballot(
    election_id: int,
    request: SubmitBallotRequest,
):
    """
    Public endpoint.

    The client creates the Semaphore proof and encrypts the ballot.
    This API receives only the ciphertext and proof.
    """

    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    proof = request.proof.model_dump()

    return execute_admin_operation(
        "submit_ballot",
        {
            "election_id": election_id,
            "encrypted_ballot": request.encrypted_ballot,
            "proof": proof,
        },
    )


@router.post(
    "/{election_id}/close",
    response_model=ElectionOperationResponse,
)
def close_election(
    election_id: int,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "close_election",
        {"election_id": election_id},
    )


@router.post(
    "/{election_id}/finalize",
    response_model=ElectionOperationResponse,
)
def finalize_election(
    election_id: int,
    _: AdminRequired,
):
    if election_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Election ID must be positive.",
        )

    return execute_admin_operation(
        "tally_election",
        {"election_id": election_id},
    )
