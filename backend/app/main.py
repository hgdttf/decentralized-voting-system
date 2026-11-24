
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.blockchain import blockchain_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Connect to the configured blockchain before accepting requests.
    """

    blockchain_service.connect()

    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Backend API for the decentralized voting system. "
        "Provides election information, voter registration status, "
        "and election management operations."
    ),
    lifespan=lifespan,
)


# Cross-Origin Resource Sharing
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# Register API version 1 routes
app.include_router(
    api_router,
    prefix=settings.api_v1_prefix,
)


@app.get("/", tags=["System"])
def root():
    return {
        "success": True,
        "application": settings.app_name,
        "version": settings.app_version,
        "documentation": "/docs",
        "api_prefix": settings.api_v1_prefix,
    }


@app.get("/health", tags=["System"])
def health():
    return {
        "success": True,
        "application": settings.app_name,
        "status": "running",
        "blockchain_connected": blockchain_service.is_connected(),
    }
