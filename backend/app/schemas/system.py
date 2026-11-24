
from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response schema for the API health endpoint."""

    status: str
    application: str
    version: str


class NetworkResponse(BaseModel):
    """Response schema for blockchain network information."""

    connected: bool
    chain_id: int
    expected_chain_id: int


class DeploymentResponse(BaseModel):
    """Response schema for deployed smart contract information."""

    network: str
    chain_id: int
    voting_address: str
    semaphore_address: str
