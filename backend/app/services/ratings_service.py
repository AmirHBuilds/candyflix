"""
Phase 12 — IMDb / Rotten Tomatoes / Metacritic scores for a title, from OMDb.

OMDb answers one lookup by IMDb id with all three, so one request per title
covers the lot. Results are cached (a day for a hit; a short time for "nothing
there" or an error, so a rate-limit day doesn't hammer OMDb and a title that
gets scores later is picked up soon).

Everything fails soft: no key, no IMDb id, OMDb down or out of requests all
give an empty list — ratings are an extra, the detail page never depends on them.
"""
import json
import logging

import httpx

from app.core.config import get_settings
from app.core.redis import get_redis
from app.schemas.ratings import RatingOut, RatingsOut
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

logger = logging.getLogger("app.ratings")

HIT_TTL = 24 * 3600
MISS_TTL = 3600
ERROR_TTL = 600


def _number(text: str | None) -> float | None:
    try:
        return float(str(text).replace(",", "").replace("%", "").split("/")[0])
    except (TypeError, ValueError):
        return None


def parse_omdb(data: dict, imdb_id: str) -> list[RatingOut]:
    """OMDb's JSON -> our ratings. Anything missing or "N/A" is left out."""
    out: list[RatingOut] = []

    imdb = _number(data.get("imdbRating"))
    if imdb is not None:
        votes = _number(data.get("imdbVotes"))
        out.append(
            RatingOut(
                source="imdb",
                label="IMDb",
                display=f"{imdb:.1f}",
                suffix="/10",
                value=imdb,
                votes=int(votes) if votes is not None else None,
                url=f"https://www.imdb.com/title/{imdb_id}/",
            )
        )

    by_source = {r.get("Source"): r.get("Value") for r in data.get("Ratings") or [] if isinstance(r, dict)}

    tomatoes = _number(by_source.get("Rotten Tomatoes"))
    if tomatoes is not None:
        out.append(
            RatingOut(source="rotten_tomatoes", label="Rotten Tomatoes", display=f"{tomatoes:.0f}%", value=tomatoes)
        )

    meta = _number(by_source.get("Metacritic")) or _number(data.get("Metascore"))
    if meta is not None:
        out.append(RatingOut(source="metacritic", label="Metacritic", display=f"{meta:.0f}", suffix="/100", value=meta))

    return out


async def _fetch_omdb(imdb_id: str) -> list[RatingOut]:
    settings = get_settings()
    redis = get_redis()
    key = f"ratings:omdb:{imdb_id}"
    cached = await redis.get(key)
    if cached is not None:
        return [RatingOut(**r) for r in json.loads(cached)]

    ttl = HIT_TTL
    ratings: list[RatingOut] = []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(settings.omdb_base_url, params={"apikey": settings.omdb_api_key, "i": imdb_id})
        if response.status_code != 200:
            logger.warning("OMDb answered %s for %s", response.status_code, imdb_id)
            ttl = ERROR_TTL
        else:
            data = response.json()
            if data.get("Response") == "False":
                logger.info("OMDb has nothing for %s: %s", imdb_id, data.get("Error"))
                ttl = ERROR_TTL if "limit" in str(data.get("Error", "")).lower() else MISS_TTL
            else:
                ratings = parse_omdb(data, imdb_id)
                if not ratings:
                    ttl = MISS_TTL
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Couldn't reach OMDb for %s: %s", imdb_id, e)
        ttl = ERROR_TTL

    await redis.set(key, json.dumps([r.model_dump() for r in ratings]), ex=ttl)
    return ratings


async def get_ratings(media_type: str, tmdb_id: int) -> RatingsOut:
    if not get_settings().omdb_api_key:
        return RatingsOut(ratings=[], configured=False)
    try:
        imdb_id = await (
            tmdb_service.get_movie_imdb_id(tmdb_id) if media_type == "movie" else tmdb_service.get_tv_imdb_id(tmdb_id)
        )
    except TMDBError:
        return RatingsOut(ratings=[], configured=True)
    if not imdb_id:
        return RatingsOut(ratings=[], configured=True)
    return RatingsOut(ratings=await _fetch_omdb(imdb_id), configured=True)
