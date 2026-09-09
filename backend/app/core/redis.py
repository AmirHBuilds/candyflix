"""
Redis client setup.

Used for caching TMDB responses (from Phase 2 onward). Kept as a thin
module so the rest of the app never imports `redis` directly.
"""
from redis.asyncio import Redis, from_url

from app.core.config import get_settings

settings = get_settings()

_redis_client: Redis | None = None


def get_redis() -> Redis:
    """Return a singleton async Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def check_redis_connection() -> bool:
    """Used by the health-check endpoint."""
    try:
        client = get_redis()
        return await client.ping()
    except Exception:
        return False
