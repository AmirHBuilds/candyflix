"""
Skip-segment lookup (Phase 9f): where the intro, recap and end credits are.

Two open, crowdsourced databases are used, in this order:
  1. SkipDB   (GET {skipdb}/api/segments?imdb_id=…[&season&episode&duration])
  2. IntroDB  (GET {introdb}/segments?imdb_id=…[&season&episode | &is_movie=true])
SkipDB answers first; IntroDB is only asked for the kinds SkipDB had nothing
for. Both report milliseconds; the app works in seconds.

Nothing from either service is stored in our database. Results live only in
Redis, briefly. A provider that is down, slow or returns junk simply counts
as "no data" — playback must never depend on this.
"""
import json
import logging

import httpx

from app.core.config import get_settings
from app.core.redis import get_redis
from app.schemas.segments import Segment, SegmentsOut

logger = logging.getLogger(__name__)

TIMEOUT = 5.0
HIT_TTL = 60 * 60 * 24  # 24 h
EMPTY_TTL = 60 * 60  # 1 h: nothing known yet, but people do add data
ERROR_TTL = 60  # a provider hiccup is retried soon
KINDS = ("intro", "recap", "credits")

# Sanity limits (seconds). Anything outside is treated as bad data.
MIN_LENGTH = 3
MAX_LENGTH = {"intro": 600, "recap": 600, "credits": 3600}


def _cache_key(imdb_id: str, season: int | None, episode: int | None, duration: float | None) -> str:
    # Rounded to 10 s: the same file always reports nearly the same length,
    # and SkipDB uses it only to line timestamps up with this exact release.
    bucket = "x" if not duration else str(int(round(duration / 10.0)))
    return f"segments:v1:{imdb_id}:{season if season is not None else '-'}:{episode if episode is not None else '-'}:{bucket}"


def _seconds(obj: object) -> tuple[float, float] | None:
    """Reads (start, end) in seconds from a provider's segment object."""
    if not isinstance(obj, dict):
        return None
    start = obj.get("start_ms")
    end = obj.get("end_ms")
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and not isinstance(start, bool):
        return start / 1000.0, end / 1000.0
    start = obj.get("start_sec")
    end = obj.get("end_sec")
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and not isinstance(start, bool):
        return float(start), float(end)
    return None


def _valid(kind: str, pair: tuple[float, float] | None, duration: float | None) -> tuple[float, float] | None:
    if pair is None:
        return None
    start, end = pair
    if start < 0 or end <= start:
        return None
    if not (MIN_LENGTH <= end - start <= MAX_LENGTH[kind]):
        return None
    if duration and start >= duration:
        return None
    if duration and end > duration:
        end = duration
    return start, end


async def _get_json(client: httpx.AsyncClient, url: str, params: dict) -> dict | None:
    """The JSON object, or None for 'nothing here' (404/204). Raises on a real failure."""
    res = await client.get(url, params=params)
    if res.status_code in (404, 204):
        return None
    res.raise_for_status()
    body = res.json()
    return body if isinstance(body, dict) else None


async def _skipdb(client, imdb_id, season, episode, duration) -> dict[str, tuple[float, float]]:
    base = get_settings().skipdb_base_url.rstrip("/")
    params: dict = {"imdb_id": imdb_id}
    if season is not None and episode is not None:
        params.update(season=season, episode=episode)
    if duration:
        params["duration"] = round(duration, 1)
    body = await _get_json(client, f"{base}/api/segments", params)
    segs = (body or {}).get("segments")
    if not isinstance(segs, dict):
        return {}
    out: dict[str, tuple[float, float]] = {}
    for kind, key in (("intro", "intro"), ("recap", "recap"), ("credits", "outro")):
        item = segs.get(key)
        if isinstance(item, dict) and item.get("match") == "out-of-range":
            continue  # SkipDB itself says the timing doesn't fit this file
        pair = _valid(kind, _seconds(item), duration)
        if pair:
            out[kind] = pair
    return out


async def _introdb(client, imdb_id, season, episode, duration) -> dict[str, tuple[float, float]]:
    base = get_settings().introdb_base_url.rstrip("/")
    params: dict = {"imdb_id": imdb_id}
    if season is not None and episode is not None:
        params.update(season=season, episode=episode)
    else:
        params["is_movie"] = "true"
    body = await _get_json(client, f"{base}/segments", params)
    if not body:
        return {}
    out: dict[str, tuple[float, float]] = {}
    for kind, key in (("intro", "intro"), ("recap", "recap"), ("credits", "outro")):
        pair = _valid(kind, _seconds(body.get(key)), duration)
        if pair:
            out[kind] = pair
    return out


async def lookup(imdb_id: str, season: int | None, episode: int | None, duration: float | None) -> SegmentsOut:
    redis = get_redis()
    key = _cache_key(imdb_id, season, episode, duration)
    try:
        cached = await redis.get(key)
    except Exception:
        cached = None
    if cached is not None:
        return SegmentsOut.model_validate(json.loads(cached))

    found: dict[str, Segment] = {}
    had_error = False
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        for source, fn in (("skipdb", _skipdb), ("introdb", _introdb)):
            if all(k in found for k in KINDS):
                break
            try:
                result = await fn(client, imdb_id, season, episode, duration)
            except Exception as exc:  # network, status, bad JSON: all "no data from this one"
                had_error = True
                logger.warning("segments: %s failed for %s: %s", source, imdb_id, exc)
                continue
            for kind, (start, end) in result.items():
                found.setdefault(kind, Segment(start=start, end=end, source=source))

    out = SegmentsOut(**found)
    ttl = HIT_TTL if found else (ERROR_TTL if had_error else EMPTY_TTL)
    try:
        await redis.set(key, out.model_dump_json(), ex=ttl)
    except Exception:
        pass
    return out
