"""
Who is watching what right now (Phase 10a).

The player sends a heartbeat every ~15 s while a video is open. Each beat
overwrites one short-lived Redis key per person (45 s TTL), so "now" fades
away on its own if a tab is closed or the network drops. Nothing is stored
in Postgres. Admin-only readers: `list_now`, `get_now`.
"""
import json
import time
import uuid
from typing import Any

from app.core.redis import get_redis

PREFIX = "presence:"
TTL_SECONDS = 45


def _key(user_id: uuid.UUID | str) -> str:
    return f"{PREFIX}{user_id}"


async def beat(
    user_id: uuid.UUID,
    *,
    tmdb_id: int,
    media_type: str,
    season_number: int | None,
    episode_number: int | None,
    position_seconds: float,
    duration_seconds: float,
    playing: bool,
) -> None:
    redis = get_redis()
    now = time.time()
    since = now
    try:
        previous = await redis.get(_key(user_id))
        if previous:
            old = json.loads(previous)
            same = (old.get("tmdb_id"), old.get("media_type"), old.get("season_number"), old.get("episode_number")) == (
                tmdb_id, media_type, season_number, episode_number,
            )
            if same:
                since = old.get("since", now)
    except Exception:
        pass
    entry = {
        "tmdb_id": tmdb_id,
        "media_type": media_type,
        "season_number": season_number,
        "episode_number": episode_number,
        "position_seconds": position_seconds,
        "duration_seconds": duration_seconds,
        "playing": playing,
        "since": since,
        "at": now,
    }
    await redis.set(_key(user_id), json.dumps(entry), ex=TTL_SECONDS)


async def stop(user_id: uuid.UUID) -> None:
    await get_redis().delete(_key(user_id))


async def get_now(user_id: uuid.UUID) -> dict[str, Any] | None:
    raw = await get_redis().get(_key(user_id))
    return json.loads(raw) if raw else None


async def list_now() -> list[tuple[uuid.UUID, dict[str, Any]]]:
    redis = get_redis()
    out: list[tuple[uuid.UUID, dict[str, Any]]] = []
    async for key in redis.scan_iter(match=f"{PREFIX}*", count=200):
        raw = await redis.get(key)
        if not raw:
            continue
        try:
            out.append((uuid.UUID(key[len(PREFIX):]), json.loads(raw)))
        except (ValueError, TypeError):
            continue
    return out
