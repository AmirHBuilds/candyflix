"""
Watchlist ("Candy Box") routes.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.models.watchlist_item import WatchlistItem
from app.schemas.watchlist import WatchlistAddRequest, WatchlistItemOut, WatchlistStatusOut
from app.services import tmdb_service, watchlist_service
from app.services.tmdb_service import TMDBError

logger = logging.getLogger("app.watchlist")

router = APIRouter(tags=["watchlist"])


async def _enrich(item: WatchlistItem) -> WatchlistItemOut | None:
    """Returns None (rather than raising) for a title TMDB can no longer
    resolve — deleted, ID typo from some future data-fix, whatever —
    so one bad row doesn't 500 someone's entire Candy Box. Logged so
    it's not a silent mystery if it happens for real."""
    try:
        detail = (
            await tmdb_service.get_movie(item.tmdb_id)
            if item.media_type == "movie"
            else await tmdb_service.get_tv(item.tmdb_id)
        )
    except TMDBError as e:
        logger.warning(
            "Couldn't enrich watchlist item %s %s: %s", item.media_type, item.tmdb_id, e
        )
        return None

    return WatchlistItemOut(
        tmdb_id=detail.tmdb_id,
        media_type=item.media_type,
        title=detail.title,
        year=detail.year,
        poster_path=detail.poster_path,
        backdrop_path=detail.backdrop_path,
        rating=detail.rating,
        added_at=item.added_at,
    )


@router.get("/watchlist", response_model=list[WatchlistItemOut])
async def get_watchlist(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await watchlist_service.list_items(db, current_user.id)
    enriched = await asyncio.gather(*(_enrich(item) for item in items))
    return [e for e in enriched if e is not None]


@router.post("/watchlist", status_code=204)
async def add_to_watchlist(
    payload: WatchlistAddRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await watchlist_service.add_item(db, current_user.id, payload.tmdb_id, payload.media_type)


@router.delete("/watchlist/{media_type}/{tmdb_id}", status_code=204)
async def remove_from_watchlist(
    media_type: str,
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")
    await watchlist_service.remove_item(db, current_user.id, tmdb_id, media_type)


@router.get("/watchlist/status", response_model=WatchlistStatusOut)
async def get_watchlist_status(
    media_type: str,
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")
    in_list = await watchlist_service.is_in_watchlist(db, current_user.id, tmdb_id, media_type)
    return WatchlistStatusOut(in_watchlist=in_list)
