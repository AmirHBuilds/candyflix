"""
TMDB service.

Owns all direct communication with TMDB and normalizes its responses
into CandyFlix's own schemas (see app.schemas.media) — nothing else in
the codebase should know TMDB's raw JSON shape. This is also the one
place a future second metadata provider would plug in alongside (or
instead of) TMDB.

Responses are cached in Redis to avoid hammering TMDB's rate limits on
every page view. Trending/search move faster (shorter TTL); movie/TV/
season details change rarely (longer TTL).
"""
import hashlib
import json

import httpx

from app.core.config import get_settings
from app.core.redis import get_redis
from app.schemas.media import (
    Episode,
    MediaItem,
    MovieDetail,
    SeasonDetail,
    SeasonSummary,
    TVShowDetail,
)

settings = get_settings()

TRENDING_CACHE_TTL = 60 * 15  # 15 minutes
SEARCH_CACHE_TTL = 60 * 15  # 15 minutes
DETAILS_CACHE_TTL = 60 * 60 * 6  # 6 hours — movie/TV/season data is fairly static


class TMDBError(Exception):
    """Raised whenever TMDB can't fulfill a request — not found, upstream
    error, or missing configuration. Routes translate this into the
    appropriate HTTP response."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def _cache_key(path: str, params: dict) -> str:
    raw = f"{path}:{sorted(params.items())}"
    digest = hashlib.sha1(raw.encode()).hexdigest()
    return f"tmdb:{digest}"


async def _get(path: str, params: dict | None = None, ttl: int = DETAILS_CACHE_TTL) -> dict:
    params = params or {}
    redis = get_redis()
    key = _cache_key(path, params)

    cached = await redis.get(key)
    if cached is not None:
        return json.loads(cached)

    if not settings.tmdb_api_key:
        raise TMDBError(500, "TMDB_API_KEY is not configured on the backend.")

    query = {**params, "api_key": settings.tmdb_api_key}
    async with httpx.AsyncClient(base_url=settings.tmdb_base_url, timeout=10.0) as client:
        try:
            response = await client.get(path, params=query)
        except httpx.RequestError as e:
            raise TMDBError(502, f"Could not reach TMDB: {e}") from e

    if response.status_code == 404:
        raise TMDBError(404, "Not found on TMDB.")
    if response.status_code != 200:
        raise TMDBError(502, f"TMDB returned an error ({response.status_code}).")

    data = response.json()
    await redis.set(key, json.dumps(data), ex=ttl)
    return data


def _to_media_item(raw: dict) -> MediaItem | None:
    """Normalizes a /trending or /search/multi result. Returns None for
    non-movie/tv results (e.g. "person"), so callers can filter them out."""
    media_type = raw.get("media_type")
    if media_type not in ("movie", "tv"):
        return None

    is_movie = media_type == "movie"
    title = raw.get("title") if is_movie else raw.get("name")
    date = raw.get("release_date") if is_movie else raw.get("first_air_date")
    year = date[:4] if date else None

    return MediaItem(
        tmdb_id=raw["id"],
        media_type=media_type,
        title=title or "Untitled",
        year=year,
        poster_path=raw.get("poster_path"),
        backdrop_path=raw.get("backdrop_path"),
    )


async def get_trending() -> list[MediaItem]:
    data = await _get("/trending/all/day", ttl=TRENDING_CACHE_TTL)
    items = (_to_media_item(r) for r in data.get("results", []))
    return [item for item in items if item is not None]


async def search(query: str) -> list[MediaItem]:
    data = await _get(
        "/search/multi",
        params={"query": query, "include_adult": "false"},
        ttl=SEARCH_CACHE_TTL,
    )
    items = (_to_media_item(r) for r in data.get("results", []))
    return [item for item in items if item is not None]


async def get_movie(tmdb_id: int) -> MovieDetail:
    data = await _get(f"/movie/{tmdb_id}", ttl=DETAILS_CACHE_TTL)
    release_date = data.get("release_date") or ""
    return MovieDetail(
        tmdb_id=data["id"],
        title=data.get("title", "Untitled"),
        overview=data.get("overview", ""),
        year=release_date[:4] or None,
        genres=[g["name"] for g in data.get("genres", [])],
        poster_path=data.get("poster_path"),
        backdrop_path=data.get("backdrop_path"),
        rating=data.get("vote_average"),
        runtime_minutes=data.get("runtime"),
    )


async def get_tv(tmdb_id: int) -> TVShowDetail:
    data = await _get(f"/tv/{tmdb_id}", ttl=DETAILS_CACHE_TTL)
    first_air_date = data.get("first_air_date") or ""

    seasons = [
        SeasonSummary(
            season_number=s["season_number"],
            name=s.get("name") or f"Season {s['season_number']}",
            episode_count=s.get("episode_count", 0),
            poster_path=s.get("poster_path"),
        )
        for s in data.get("seasons", [])
        if s.get("season_number", 0) > 0  # skip "Specials" (season 0) for MVP simplicity
    ]

    return TVShowDetail(
        tmdb_id=data["id"],
        title=data.get("name", "Untitled"),
        overview=data.get("overview", ""),
        year=first_air_date[:4] or None,
        genres=[g["name"] for g in data.get("genres", [])],
        poster_path=data.get("poster_path"),
        backdrop_path=data.get("backdrop_path"),
        rating=data.get("vote_average"),
        seasons=seasons,
    )


async def get_season(tv_id: int, season_number: int) -> SeasonDetail:
    data = await _get(f"/tv/{tv_id}/season/{season_number}", ttl=DETAILS_CACHE_TTL)

    episodes = [
        Episode(
            episode_number=e["episode_number"],
            name=e.get("name") or f"Episode {e['episode_number']}",
            overview=e.get("overview", ""),
            still_path=e.get("still_path"),
            air_date=e.get("air_date"),
            runtime_minutes=e.get("runtime"),
        )
        for e in data.get("episodes", [])
    ]

    return SeasonDetail(
        tv_id=tv_id,
        season_number=season_number,
        name=data.get("name") or f"Season {season_number}",
        episodes=episodes,
    )
