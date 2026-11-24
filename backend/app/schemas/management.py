
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


PositiveElectionId = Annotated[int, Field(ge=1)]
NonEmptyName = Annotated[str, Field(min_length=1, max_length=100)]
Uint256String = Annotated[
    str,
    Field(pattern=r"^(0|[1-9][0-9]{0,77})$"),
]


class StrictRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class CreateElectionRequest(StrictRequest):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    start_time: Annotated[int, Field(gt=0)]
    end_time: Annotated[int, Field(gt=0)]
    candidates: Annotated[
        list[NonEmptyName],
        Field(min_length=2, max_length=100),
    ]

    @field_validator("candidates")
    @classmethod
    def validate_candidates(cls, candidates: list[str]) -> list[str]:
        normalized = [name.casefold() for name in candidates]

        if len(normalized) != len(set(normalized)):
            raise ValueError("Candidate names must be unique.")

        return candidates

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time.")

        return self


class AddCandidateRequest(StrictRequest):
    name: NonEmptyName


class RegisterVoterRequest(StrictRequest):
    commitment: Uint256String

    @field_validator("commitment")
    @classmethod
    def validate_commitment(cls, value: str) -> str:
        number = int(value)

        if number <= 0 or number >= 2**256:
            raise ValueError("Commitment must be a nonzero uint256.")

        return value


class SemaphoreProofRequest(StrictRequest):
    merkleTreeDepth: Annotated[int, Field(ge=1, le=32)]
    merkleTreeRoot: Uint256String
    nullifier: Uint256String
    message: Uint256String
    scope: Uint256String
    points: Annotated[
        list[Uint256String],
        Field(min_length=8, max_length=8),
    ]

    @field_validator(
        "merkleTreeRoot",
        "nullifier",
        "message",
        "scope",
    )
    @classmethod
    def validate_uint256(cls, value: str) -> str:
        if int(value) >= 2**256:
            raise ValueError("Proof value exceeds uint256.")

        return value

    @field_validator("points")
    @classmethod
    def validate_points(cls, points: list[str]) -> list[str]:
        if any(int(point) >= 2**256 for point in points):
            raise ValueError("Proof point exceeds uint256.")

        return points


class SubmitBallotRequest(StrictRequest):
    encrypted_ballot: Annotated[
        str,
        Field(pattern=r"^0x(?:[0-9a-fA-F]{2})+$"),
    ]
    proof: SemaphoreProofRequest


class ElectionOperationResponse(BaseModel):
    success: bool
    message: str
    data: dict | list | str | int | None = None
