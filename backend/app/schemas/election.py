
from pydantic import BaseModel, Field


class ElectionSummary(BaseModel):
    """Public summary of an election."""

    election_id: int = Field(gt=0)
    title: str
    admin: str
    start_time: int
    end_time: int
    registered_voter_count: int
    accepted_ballot_count: int
    total_valid_votes: int
    status: str


class ElectionListResponse(BaseModel):
    """Response containing all available elections."""

    total_elections: int
    elections: list[ElectionSummary]


class ElectionDetail(ElectionSummary):
    """Detailed public election information."""

    group_id: int
    candidate_count: int


class CandidateResponse(BaseModel):
    """Public information about an election candidate."""

    candidate_id: int = Field(ge=1)
    name: str


class CandidateListResponse(BaseModel):
    """Response containing candidates for an election."""

    election_id: int
    total_candidates: int
    candidates: list[CandidateResponse]


class ElectionStatusResponse(BaseModel):
    """Response containing election lifecycle information."""

    election_id: int
    status: str
    start_time: int
    end_time: int
    registered_voter_count: int
    accepted_ballot_count: int


class CandidateResult(BaseModel):
    """Final vote count for an individual candidate."""

    candidate_id: int = Field(ge=1)
    candidate_name: str
    votes: int


class ElectionResultsResponse(BaseModel):
    """Finalized results for an election."""

    election_id: int
    total_valid_votes: int
    results: list[CandidateResult]


class ElectionVotingConfigResponse(BaseModel):
    """Public configuration required by the frontend to prepare a ballot."""

    election_id: int
    semaphore_group_id: int
    semaphore_scope: int
    encryption_public_key: str
    public_key_published: bool
