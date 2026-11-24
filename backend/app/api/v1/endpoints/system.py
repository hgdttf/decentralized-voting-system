
from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas.system import (
    DeploymentResponse,
    HealthResponse,
    NetworkResponse,
)
from app.services.blockchain import (
    BlockchainConnectionError,
    blockchain_service,
)


router = APIRouter(tags=["System"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check API health",
)
def health_check() -> HealthResponse:
    """Return the API's basic health information."""

    return HealthResponse(
        status="ok",
        application=settings.app_name,
        version=settings.app_version,
    )


@router.get(
    "/network",
    response_model=NetworkResponse,
    summary="Check blockchain connectivity",
)
def network_status() -> NetworkResponse:
    """Check the active blockchain connection and chain ID."""

    try:
        connected = blockchain_service.w3.is_connected()

        if not connected:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Blockchain RPC endpoint is unavailable.",
            )

        actual_chain_id = blockchain_service.w3.eth.chain_id

        if actual_chain_id != settings.expected_chain_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"Chain ID mismatch. Expected "
                    f"{settings.expected_chain_id}, "
                    f"received {actual_chain_id}."
                ),
            )

        return NetworkResponse(
            connected=True,
            chain_id=actual_chain_id,
            expected_chain_id=settings.expected_chain_id,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve blockchain network status.",
        ) from exc


@router.get(
    "/deployment",
    response_model=DeploymentResponse,
    summary="Get deployed contract information",
)
def deployment_information() -> DeploymentResponse:
    """Return the addresses of the deployed Voting and Semaphore contracts."""

    try:
        blockchain_service.get_voting_contract()

        if blockchain_service.chain_id is None:
            raise BlockchainConnectionError(
                "Blockchain service has not been initialized."
            )

        if blockchain_service.voting_address is None:
            raise BlockchainConnectionError(
                "Voting contract address is unavailable."
            )

        if blockchain_service.semaphore_address is None:
            raise BlockchainConnectionError(
                "Semaphore contract address is unavailable."
            )

        return DeploymentResponse(
            network="localhost",
            chain_id=blockchain_service.chain_id,
            voting_address=blockchain_service.voting_address,
            semaphore_address=blockchain_service.semaphore_address,
        )

    except BlockchainConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
