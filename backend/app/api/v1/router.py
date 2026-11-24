
from fastapi import APIRouter

from app.api.v1.endpoints import (
    elections,
    management,
    registration,
    system,
)


api_router = APIRouter()

api_router.include_router(system.router)
api_router.include_router(elections.router)
api_router.include_router(registration.router)
api_router.include_router(management.router)
