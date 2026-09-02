"""
Health-check endpoints.

Used to verify the API is up, and that it can reach its dependencies
(PostgreSQL, Redis). Useful for local dev sanity checks and later for
container orchestration health probes.
"""
from fastapi import APIRouter

from app.core.db import check_db_connection
from app.core.redis import check_redis_connection

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Basic liveness check — the API process is up."""
    return {"status": "ok"}


@router.get("/health/db")
async def health_db() -> dict:
    """Checks connectivity to PostgreSQL."""
    ok = await check_db_connection()
    return {"database": "connected" if ok else "unreachable"}


@router.get("/health/redis")
async def health_redis() -> dict:
    """Checks connectivity to Redis."""
    ok = await check_redis_connection()
    return {"redis": "connected" if ok else "unreachable"}


@router.get("/health/full")
async def health_full() -> dict:
    """Combined check — API, database, and Redis all in one call."""
    db_ok = await check_db_connection()
    redis_ok = await check_redis_connection()
    return {
        "status": "ok" if (db_ok and redis_ok) else "degraded",
        "database": "connected" if db_ok else "unreachable",
        "redis": "connected" if redis_ok else "unreachable",
    }
