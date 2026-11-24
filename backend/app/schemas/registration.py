from pydantic import BaseModel, ConfigDict, Field

class RegistrationStatusResponse(BaseModel):
    """Public registration status for a single identity commitment."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )

    election_id: int = Field(ge=1)
    commitment: str
    registered: bool
