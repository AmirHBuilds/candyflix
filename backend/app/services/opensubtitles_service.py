"""
OpenSubtitles service (Phase 5b — online subtitle discovery).

Unlike TMDB, this genuinely is a real third-party integration — the
providers/ package's "no real third-party providers" rule is about
*playback* sources specifically (see its README), not subtitles.

Two API calls matter here:
- GET  /subtitles  — search by IMDb id (+ season/episode for TV), returns
  metadata + a `file_id` per result, not the subtitle text itself.
- POST /download   — exchanges a `file_id` for a short-lived download link.
  This is the quota-metered call (a small daily allowance on the free
  tier), which is why downloaded files are cached to disk indefinitely:
  the same (title, season, episode, language) should only ever cost one
  unit of quota, no matter how many times it's watched.

Logging in via username/password (both optional) raises that daily
quota but isn't required — search and download both work on the API
key alone, just with a lower ceiling.
"""
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.language_labels import label_for
from app.core.redis import get_redis
from app.schemas.subtitles import OnlineSubtitleResult

OPENSUBTITLES_BASE = "https://api.opensubtitles.com/api/v1"

_TOKEN_CACHE_KEY = "opensubtitles:auth-token"
_TOKEN_TTL = 60 * 60 * 20  # sessions last ~24h server-side; refresh a bit early


class OpenSubtitlesError(Exception):
    """Raised for anything that stops search/download from completing —
    missing API key, upstream error, or quota exhaustion. Routes translate
    this into the appropriate HTTP response, same pattern as TMDBError."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def _require_api_key() -> str:
    settings = get_settings()
    if not settings.opensubtitles_api_key:
        raise OpenSubtitlesError(
            500,
            "OPENSUBTITLES_API_KEY is not configured on the backend. Get a free "
            "key at https://www.opensubtitles.com/en/consumers and set it in .env.",
        )
    return settings.opensubtitles_api_key


def _headers() -> dict:
    settings = get_settings()
    return {
        "Api-Key": _require_api_key(),
        "User-Agent": settings.opensubtitles_user_agent,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def _get_auth_token() -> str | None:
    """None means "proceed unauthenticated" — a missing/failed login should
    never block search or download, just leave them at the lower quota."""
    settings = get_settings()
    if not settings.opensubtitles_username or not settings.opensubtitles_password:
        return None

    redis = get_redis()
    cached = await redis.get(_TOKEN_CACHE_KEY)
    if cached:
        return cached

    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=10.0) as client:
        try:
            response = await client.post(
                "/login",
                headers=_headers(),
                json={
                    "username": settings.opensubtitles_username,
                    "password": settings.opensubtitles_password,
                },
            )
        except httpx.RequestError:
            return None

    if response.status_code != 200:
        return None

    token = response.json().get("token")
    if token:
        await redis.set(_TOKEN_CACHE_KEY, token, ex=_TOKEN_TTL)
    return token


async def _auth_headers() -> dict:
    headers = _headers()
    token = await _get_auth_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _imdb_id_to_numeric(imdb_id: str) -> int:
    """TMDB gives imdb_id as e.g. "tt0903747"; OpenSubtitles' `imdb_id`
    query param wants the bare number (leading zeros and all dropped)."""
    return int(imdb_id.lower().removeprefix("tt"))


async def search(
    imdb_id: str,
    season_number: int | None = None,
    episode_number: int | None = None,
    language: str | None = None,
) -> list[OnlineSubtitleResult]:
    params: dict[str, str | int] = {"imdb_id": _imdb_id_to_numeric(imdb_id)}
    if season_number is not None:
        params["season_number"] = season_number
    if episode_number is not None:
        params["episode_number"] = episode_number
    if language:
        params["languages"] = language

    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=10.0) as client:
        try:
            response = await client.get("/subtitles", headers=_headers(), params=params)
        except httpx.RequestError as e:
            raise OpenSubtitlesError(502, f"Could not reach OpenSubtitles: {e}") from e

    if response.status_code == 401:
        raise OpenSubtitlesError(401, "OpenSubtitles rejected the configured API key.")
    if response.status_code != 200:
        raise OpenSubtitlesError(502, f"OpenSubtitles returned an error ({response.status_code}).")

    data = response.json()
    results: list[OnlineSubtitleResult] = []
    for item in data.get("data", []):
        attrs = item.get("attributes", {})
        files = attrs.get("files") or []
        if not files:
            continue
        lang = attrs.get("language") or "und"
        results.append(
            OnlineSubtitleResult(
                file_id=files[0]["file_id"],
                language=lang,
                label=label_for(lang),
                release=attrs.get("release"),
                downloads=attrs.get("download_count") or 0,
                rating=attrs.get("ratings"),
                hearing_impaired=bool(attrs.get("hearing_impaired")),
            )
        )

    # Most-downloaded first — a reasonable default "best" ordering rather
    # than asking the person to judge raw upload quality themselves.
    results.sort(key=lambda r: r.downloads, reverse=True)
    return results


async def download(file_id: int, cache_key: str) -> Path:
    """Returns the local path to the (now-cached) subtitle file. If this
    file_id was already downloaded under this cache_key, returns the
    existing file immediately without spending any download quota."""
    settings = get_settings()
    cache_dir = Path(settings.subtitle_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    cached_path = cache_dir / f"{cache_key}.srt"
    if cached_path.exists():
        return cached_path

    headers = await _auth_headers()
    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=15.0) as client:
        try:
            response = await client.post("/download", headers=headers, json={"file_id": file_id})
        except httpx.RequestError as e:
            raise OpenSubtitlesError(502, f"Could not reach OpenSubtitles: {e}") from e

    if response.status_code == 406:
        raise OpenSubtitlesError(429, "OpenSubtitles daily download quota reached — try again tomorrow.")
    if response.status_code != 200:
        raise OpenSubtitlesError(502, f"OpenSubtitles returned an error ({response.status_code}).")

    link = response.json().get("link")
    if not link:
        raise OpenSubtitlesError(502, "OpenSubtitles didn't return a download link.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            file_response = await client.get(link)
        except httpx.RequestError as e:
            raise OpenSubtitlesError(502, f"Could not download the subtitle file: {e}") from e

    if file_response.status_code != 200:
        raise OpenSubtitlesError(502, "Could not download the subtitle file contents.")

    cached_path.write_bytes(file_response.content)
    return cached_path
