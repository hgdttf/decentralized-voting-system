
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Decentralized Voting API"
    app_version: str = "1.0.0"
    api_v1_prefix: str = "/api/v1"

    blockchain_rpc_url: str = "http://127.0.0.1:8545"
    expected_chain_id: int = Field(default=1337, gt=0)
    deployment_file: str = "../deployments/localhost.json"

    cors_origins: str = (
        "http://localhost:3000,http://localhost:5173"
    )

    # Required for all administrative write operations.
    # Keep this value in backend/.env, never in source control.
    admin_api_token: str = ""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def deployment_path(self) -> Path:
        return (BACKEND_DIR / self.deployment_file).resolve()

    @property
    def allowed_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


settings = Settings()
