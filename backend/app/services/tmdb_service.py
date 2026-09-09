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


def _to_media_item_typed(raw: dict, media_type: str) -> MediaItem:
    """
    Normalizes a raw TMDB item into a MediaItem, given a known
    media_type. Used for endpoints where TMDB doesn't echo back
    media_type per item because it's implied by which endpoint you
    called (popular movies, popular TV, similar titles, etc).
    """
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
        rating=raw.get("vote_average"),
    )


def _to_media_item(raw: dict) -> MediaItem | None:
    """Normalizes a /trending or /search/multi result, which DOES include
    media_type per item. Returns None for non-movie/tv results (e.g.
    "person"), so callers can filter them out."""
    media_type = raw.get("media_type")
    if media_type not in ("movie", "tv"):
        return None
    return _to_media_item_typed(raw, media_type)


HOME_SECTION_TARGET = 24  # keep in sync with the frontend's row-completing cap


async def _get_multi_page(path: str, ttl: int, normalize, target: int = HOME_SECTION_TARGET) -> list:
    """
    Fetches TMDB pages (20 results each) until `target` normalized items
    are collected or TMDB runs out of pages. A single page is often not
    enough to fill a multi-column grid's rows evenly — TMDB's fixed
    20-per-page doesn't divide evenly into a 4- or 6-column grid — so
    home page sections pull a second page rather than showing a short,
    ragged final row.
    """
    collected = []
    seen = set()
    page = 1
    while len(collected) < target:
        data = await _get(path, params={"page": page}, ttl=ttl)
        raw_results = data.get("results", [])
        if not raw_results:
            break
        for raw in raw_results:
            item = normalize(raw)
            if item is None:
                continue
            dedup_key = (item.media_type, item.tmdb_id)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            collected.append(item)
        total_pages = data.get("total_pages", page)
        if page >= total_pages:
            break
        page += 1
    return collected[:target]


async def get_trending(window: str = "day") -> list[MediaItem]:
    """window is 'day' or 'week'."""
    return await _get_multi_page(f"/trending/all/{window}", TRENDING_CACHE_TTL, _to_media_item)


async def get_popular_movies() -> list[MediaItem]:
    return await _get_multi_page(
        "/movie/popular", TRENDING_CACHE_TTL, lambda r: _to_media_item_typed(r, "movie")
    )


async def get_popular_tv() -> list[MediaItem]:
    return await _get_multi_page(
        "/tv/popular", TRENDING_CACHE_TTL, lambda r: _to_media_item_typed(r, "tv")
    )


SIMILAR_TARGET = 12  # "You May Also Like" doesn't need to fill a full multi-row grid


async def get_similar_movies(tmdb_id: int) -> list[MediaItem]:
    return await _get_multi_page(
        f"/movie/{tmdb_id}/similar",
        DETAILS_CACHE_TTL,
        lambda r: _to_media_item_typed(r, "movie"),
        target=SIMILAR_TARGET,
    )


async def get_similar_tv(tmdb_id: int) -> list[MediaItem]:
    return await _get_multi_page(
        f"/tv/{tmdb_id}/similar",
        DETAILS_CACHE_TTL,
        lambda r: _to_media_item_typed(r, "tv"),
        target=SIMILAR_TARGET,
    )


async def get_popular_movies_page(page: int = 1) -> tuple[list[MediaItem], bool]:
    """Plain single TMDB page for the Movies page's Load More button.
    Deliberately doesn't use _get_multi_page's row-completing logic —
    each click shows exactly what that TMDB page has (up to 20), and a
    ragged last row per page-load is an accepted tradeoff here."""
    data = await _get("/movie/popular", params={"page": page}, ttl=TRENDING_CACHE_TTL)
    items = [_to_media_item_typed(r, "movie") for r in data.get("results", [])]
    total_pages = data.get("total_pages", page)
    return items, page < total_pages


async def get_popular_tv_page(page: int = 1) -> tuple[list[MediaItem], bool]:
    data = await _get("/tv/popular", params={"page": page}, ttl=TRENDING_CACHE_TTL)
    items = [_to_media_item_typed(r, "tv") for r in data.get("results", [])]
    total_pages = data.get("total_pages", page)
    return items, page < total_pages


# Official TMDB genre IDs — stable and effectively never change, so
# hardcoding avoids an extra round trip just to populate a dropdown.
MOVIE_GENRES = [
    {"id": 28, "name": "Action"},
    {"id": 12, "name": "Adventure"},
    {"id": 16, "name": "Animation"},
    {"id": 35, "name": "Comedy"},
    {"id": 80, "name": "Crime"},
    {"id": 99, "name": "Documentary"},
    {"id": 18, "name": "Drama"},
    {"id": 10751, "name": "Family"},
    {"id": 14, "name": "Fantasy"},
    {"id": 36, "name": "History"},
    {"id": 27, "name": "Horror"},
    {"id": 10402, "name": "Music"},
    {"id": 9648, "name": "Mystery"},
    {"id": 10749, "name": "Romance"},
    {"id": 878, "name": "Science Fiction"},
    {"id": 53, "name": "Thriller"},
    {"id": 10752, "name": "War"},
    {"id": 37, "name": "Western"},
]

TV_GENRES = [
    {"id": 10759, "name": "Action & Adventure"},
    {"id": 16, "name": "Animation"},
    {"id": 35, "name": "Comedy"},
    {"id": 80, "name": "Crime"},
    {"id": 99, "name": "Documentary"},
    {"id": 18, "name": "Drama"},
    {"id": 10751, "name": "Family"},
    {"id": 9648, "name": "Mystery"},
    {"id": 10765, "name": "Sci-Fi & Fantasy"},
    {"id": 10768, "name": "War & Politics"},
    {"id": 37, "name": "Western"},
]

# The frontend sends a media-type-agnostic sort key; we map it to the
# TMDB-specific sort_by string each endpoint actually expects.
_MOVIE_SORTS = {
    "popularity": "popularity.desc",
    "rating": "vote_average.desc",
    "newest": "primary_release_date.desc",
}
_TV_SORTS = {
    "popularity": "popularity.desc",
    "rating": "vote_average.desc",
    "newest": "first_air_date.desc",
}


async def discover_movies(
    page: int = 1,
    genre: int | None = None,
    year: int | None = None,
    sort: str = "popularity",
    min_rating: float | None = None,
) -> tuple[list[MediaItem], bool]:
    params: dict = {"page": page, "sort_by": _MOVIE_SORTS.get(sort, "popularity.desc")}
    if genre is not None:
        params["with_genres"] = genre
    if year is not None:
        params["primary_release_year"] = year
    if min_rating is not None:
        params["vote_average.gte"] = min_rating
        # Without a vote-count floor, "highly rated" filters get swamped
        # by obscure titles with a single 10/10 vote.
        params["vote_count.gte"] = 50

    data = await _get("/discover/movie", params=params, ttl=TRENDING_CACHE_TTL)
    items = [_to_media_item_typed(r, "movie") for r in data.get("results", [])]
    total_pages = data.get("total_pages", page)
    return items, page < total_pages


async def discover_tv(
    page: int = 1,
    genre: int | None = None,
    year: int | None = None,
    sort: str = "popularity",
    min_rating: float | None = None,
) -> tuple[list[MediaItem], bool]:
    params: dict = {"page": page, "sort_by": _TV_SORTS.get(sort, "popularity.desc")}
    if genre is not None:
        params["with_genres"] = genre
    if year is not None:
        params["first_air_date_year"] = year
    if min_rating is not None:
        params["vote_average.gte"] = min_rating
        params["vote_count.gte"] = 50

    data = await _get("/discover/tv", params=params, ttl=TRENDING_CACHE_TTL)
    items = [_to_media_item_typed(r, "tv") for r in data.get("results", [])]
    total_pages = data.get("total_pages", page)
    return items, page < total_pages


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
