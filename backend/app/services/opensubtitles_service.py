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

Logging in via username/password raises the daily quota, and in
practice may be necessary at all — OpenSubtitles has a history of
throttling or rejecting requests that only carry an API key with no
logged-in user behind them. Both `search` and `download` attach a
login token whenever credentials are configured; if they aren't,
requests still go out key-only, which may or may not be enough
depending on how strict OpenSubtitles is being that day.

Every httpx.AsyncClient here is created with follow_redirects=True.
httpx defaults to NOT following redirects, and OpenSubtitles' /subtitles
endpoint has been observed 301-redirecting some requests — without
this, that redirect response (a small HTML page, not JSON) gets treated
as the real API response and fails to parse, surfacing as a confusing
"OpenSubtitles returned an unexpected error (301)".
"""
import logging
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.language_labels import label_for
from app.core.redis import get_redis
from app.schemas.subtitles import OnlineSubtitleResult

logger = logging.getLogger("app.opensubtitles")

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


def _upstream_message(response: httpx.Response) -> str:
    """OpenSubtitles usually returns {"message": "..."} (or sometimes
    Cloudflare's own HTML challenge/error page for rate-limits and bot
    protection). Pulls out whatever's actually useful, since "OpenSubtitles
    returned an error (502)" with no further detail is close to useless
    for actually diagnosing what went wrong."""
    try:
        body = response.json()
        if isinstance(body, dict) and body.get("message"):
            return str(body["message"])
    except ValueError:
        pass
    text = response.text.strip().replace("\n", " ")
    return text[:200] if text else "(empty response body)"


def _error_for_status(response: httpx.Response, action: str) -> OpenSubtitlesError:
    """Logs the full detail server-side (status + body), and returns an
    error whose status code is the upstream one whenever it's something
    the caller can actually act on (bad key, rate-limited, not found) —
    502 is reserved for things that are genuinely "the upstream is
    broken/unreachable", not just "it said no"."""
    upstream_message = _upstream_message(response)
    logger.warning(
        "OpenSubtitles %s failed: %s %s — %s",
        action,
        response.status_code,
        response.request.url,
        upstream_message,
    )
    if response.status_code in (400, 401, 403, 404, 429):
        return OpenSubtitlesError(response.status_code, f"OpenSubtitles: {upstream_message}")
    return OpenSubtitlesError(
        502, f"OpenSubtitles returned an unexpected error ({response.status_code}): {upstream_message}"
    )


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

    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=10.0, follow_redirects=True) as client:
        try:
            response = await client.post(
                "/login",
                headers=_headers(),
                json={
                    "username": settings.opensubtitles_username,
                    "password": settings.opensubtitles_password,
                },
            )
        except httpx.RequestError as e:
            logger.warning("OpenSubtitles login request failed: %s", e)
            return None

    if response.status_code != 200:
        logger.warning(
            "OpenSubtitles login rejected (%s): %s", response.status_code, _upstream_message(response)
        )
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


def build_cache_key(
    media_type: str,
    tmdb_id: int,
    season_number: int | None,
    episode_number: int | None,
    language: str,
    file_id: int,
) -> str:
    parts = [media_type, str(tmdb_id)]
    if season_number is not None and episode_number is not None:
        parts.append(f"s{season_number}e{episode_number}")
    parts.append(language)
    parts.append(str(file_id))
    return "-".join(parts)


def _imdb_id_to_numeric(imdb_id: str) -> int:
    """TMDB gives imdb_id as e.g. "tt0903747"; OpenSubtitles' `imdb_id`
    query param wants the bare number (leading zeros and all dropped)."""
    return int(imdb_id.lower().removeprefix("tt"))


async def search(
    imdb_id: str,
    season_number: int | None = None,
    episode_number: int | None = None,
    language: str | None = None,
    query: str | None = None,
) -> list[OnlineSubtitleResult]:
    """`query`, when given, filters down to results whose release name
    contains it (case-insensitive) — e.g. "bluray" to find uploads
    matching a specific release/cut, since different releases of the
    same title can be a second or two out of sync with each other even
    with an identical translation. This is filtered here, not sent to
    OpenSubtitles: a search scoped to one imdb_id already returns every
    upload across every language and release for that title in one
    response, so there's no need for a separate text-search round trip —
    filtering the list we already have is simpler and doesn't cost any
    extra quota."""
    params: dict[str, str | int] = {"imdb_id": _imdb_id_to_numeric(imdb_id)}
    if season_number is not None:
        params["season_number"] = season_number
    if episode_number is not None:
        params["episode_number"] = episode_number
    if language:
        params["languages"] = language

    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=10.0, follow_redirects=True) as client:
        try:
            response = await client.get("/subtitles", headers=await _auth_headers(), params=params)
        except httpx.RequestError as e:
            logger.warning("OpenSubtitles search request failed to reach the server: %s", e)
            raise OpenSubtitlesError(502, f"Could not reach OpenSubtitles: {e}") from e

    if response.status_code != 200:
        raise _error_for_status(response, "search")

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

    if query:
        q = query.strip().lower()
        results = [r for r in results if q in (r.release or "").lower()]

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
    async with httpx.AsyncClient(base_url=OPENSUBTITLES_BASE, timeout=15.0, follow_redirects=True) as client:
        try:
            response = await client.post("/download", headers=headers, json={"file_id": file_id})
        except httpx.RequestError as e:
            logger.warning("OpenSubtitles download request failed to reach the server: %s", e)
            raise OpenSubtitlesError(502, f"Could not reach OpenSubtitles: {e}") from e

    if response.status_code == 406:
        raise OpenSubtitlesError(429, "OpenSubtitles daily download quota reached — try again tomorrow.")
    if response.status_code != 200:
        raise _error_for_status(response, "download")

    link = response.json().get("link")
    if not link:
        raise OpenSubtitlesError(502, "OpenSubtitles didn't return a download link.")

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        try:
            file_response = await client.get(link)
        except httpx.RequestError as e:
            logger.warning("Fetching the downloaded subtitle file failed: %s", e)
            raise OpenSubtitlesError(502, f"Could not download the subtitle file: {e}") from e

    if file_response.status_code != 200:
        logger.warning("Subtitle file link returned %s", file_response.status_code)
        raise OpenSubtitlesError(502, "Could not download the subtitle file contents.")

    cached_path.write_bytes(file_response.content)
    return cached_path
