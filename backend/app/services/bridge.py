
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from fastapi import HTTPException, status


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ENV_FILE = BACKEND_DIR / ".env"

HARDHAT_EXECUTABLE = PROJECT_ROOT / "node_modules" / ".bin" / "hardhat"
BRIDGE_SCRIPT = PROJECT_ROOT / "scripts" / "api-bridge.ts"

ALLOWED_ACTIONS = {
    "create_election",
    "add_candidate",
    "register_voter",
    "publish_election_key",
    "start_voting",
    "submit_ballot",
    "close_election",
    "tally_election",
}


class BridgeService:
    """Execute approved blockchain operations through the Hardhat bridge."""

    def __init__(self) -> None:
        self.timeout_seconds = 180

    def execute(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        if action not in ALLOWED_ACTIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported blockchain operation.",
            )

        if not HARDHAT_EXECUTABLE.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Hardhat executable was not found.",
            )

        if not BRIDGE_SCRIPT.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Blockchain bridge script was not found.",
            )

        if not ENV_FILE.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Backend environment configuration was not found.",
            )

        # Start with the existing process environment.
        child_env = os.environ.copy()

        # Explicitly load backend/.env for the Hardhat subprocess.
        file_env = dotenv_values(ENV_FILE)

        for key, value in file_env.items():
            if value is not None:
                child_env.setdefault(key, value)

        # Require election-key passphrase for key publication and tally.
        if action in {"publish_election_key", "tally_election"}:
            passphrase = child_env.get("ELECTION_KEY_PASSPHRASE", "")
            if not passphrase or len(passphrase) < 12:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Election key passphrase is missing or too short.",
                )

        request_data = {
            "action": action,
            "payload": payload or {},
        }

        try:
            completed = subprocess.run(
                [
                    str(HARDHAT_EXECUTABLE),
                    "run",
                    str(BRIDGE_SCRIPT.relative_to(PROJECT_ROOT)),
                    "--network",
                    "localhost",
                ],
                cwd=str(PROJECT_ROOT),
                env=child_env,
                input=json.dumps(request_data),
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                check=False,
                shell=False,
            )

        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Blockchain operation timed out.",
            ) from exc

        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to execute the blockchain bridge.",
            ) from exc

        output_lines = [
            line.strip()
            for line in completed.stdout.splitlines()
            if line.strip()
        ]

        response_data: dict[str, Any] | None = None

        for line in reversed(output_lines):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue

            if (
                isinstance(candidate, dict)
                and "success" in candidate
            ):
                response_data = candidate
                break

        if response_data is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Blockchain bridge returned an invalid response.",
            )

        if (
            completed.returncode != 0
            or response_data.get("success") is not True
        ):
            error_message = response_data.get(
                "error",
                "Blockchain transaction failed.",
            )

            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(error_message),
            )

        return response_data.get("data")


bridge_service = BridgeService()
