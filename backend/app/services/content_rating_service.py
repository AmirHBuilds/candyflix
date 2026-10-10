"""
Age limits: an admin can give an account a highest age rating (G, PG, PG-13 or R). Anything above
it, or without a known rating, is hidden from that person everywhere: lists, search, Ask AI, detail
pages, watchlist, continue watching, and playback itself.

Ratings come from TMDB (the US certification): movies G / PG / PG-13 / R / NC-17, shows TV-Y / TV-Y7 /
TV-G / TV-PG / TV-14 / TV-MA. Shows are lined up with movies like this:
TV-Y, TV-Y7, TV-G = G;  TV-PG = PG;  TV-14 = PG-13;  TV-MA = R.
A title with no rating on TMDB is hidden from limited accounts (better safe than sorry), and titles
TMDB flags as adult are always hidden from them. Accounts without a limit are never affected, and
cost no extra TMDB calls.
"""
import asyncio

from fastapi import HTTPException

from app.models.user import User
from app.services import tmdb_service

LEVELS = ["G", "PG", "PG-13", "R"]  # the choices an admin has, mildest first

_RANK = {
    "G": 0, "TV-Y": 0, "TV-Y7": 0, "TV-G": 0,
    "PG": 1, "TV-PG": 1,
    "PG-13": 2, "TV-14": 2,
    "R": 3, "TV-MA": 3,
    "NC-17": 4,
}

NOT_ALLOWED = "This title isn't available for your account."


def limit_rank(user: User) -> int | None:
    """The highest rank this person may watch, or None if they have no limit."""
    code = getattr(user, "age_limit", None)
    return LEVELS.index(code) if code in LEVELS else None


def is_limited(user: User) -> bool:
    return limit_rank(user) is not None


async def rank_of(media_type: str, tmdb_id: int) -> int | None:
    """0..4, or None when the title has no rating we recognise."""
    try:
        cert = await tmdb_service.get_certification(media_type, tmdb_id)
    except Exception:
        return None
    if cert is None:
        return None
    return _RANK.get(cert.upper())


async def allowed(user: User, media_type: str, tmdb_id: int) -> bool:
    cap = limit_rank(user)
    if cap is None:
        return True
    try:
        if await tmdb_service.is_adult_flagged(media_type, tmdb_id):
            return False
    except Exception:
        pass
    rank = await rank_of(media_type, tmdb_id)
    return rank is not None and rank <= cap


async def ensure(user: User, media_type: str, tmdb_id: int) -> None:
    if not await allowed(user, media_type, tmdb_id):
        raise HTTPException(status_code=403, detail=NOT_ALLOWED)


async def filter_items(user: User, items: list, media_type: str | None = None) -> list:
    """Keeps what this person may see. Each item needs `.tmdb_id` and `.media_type` (or pass media_type)."""
    if not is_limited(user) or not items:
        return items
    sem = asyncio.Semaphore(8)

    async def ok(item) -> bool:
        async with sem:
            return await allowed(user, media_type or item.media_type, item.tmdb_id)

    flags = await asyncio.gather(*(ok(i) for i in items))
    return [i for i, keep in zip(items, flags) if keep]
