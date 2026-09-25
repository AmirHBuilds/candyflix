"""
Continue Watching routes (Phase 7).

Follows the exact enrichment pattern established in watchlist.py: a
WatchProgress row only ever stores identity (tmdb_id/media_type/season/
episode — see PHASE_HANDOFF.md §3.3), so display data is fetched fresh
from TMDB here, and a title TMDB can no longer resolve is skipped
rather than 500ing the whole row.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.models.watch_progress import WatchProgress
from app.schemas.continue_watching import ContinueWatchingItemOut
from app.services import tmdb_service, watch_progress_service
from app.services.tmdb_service import TMDBError

logger = logging.getLogger("app.continue_watching")

router = APIRouter(tags=["continue-watching"])


async def _enrich(row: WatchProgress) -> ContinueWatchingItemOut | None:
    try:
        detail = (
            await tmdb_service.get_movie(row.tmdb_id)
            if row.media_type == "movie"
            else await tmdb_service.get_tv(row.tmdb_id)
        )
    except TMDBError as e:
        logger.warning(
            "Couldn't enrich continue-watching item %s %s: %s", row.media_type, row.tmdb_id, e
        )
        return None

    season_number, episode_number = watch_progress_service.display_season_episode(row)
    return ContinueWatchingItemOut(
        tmdb_id=detail.tmdb_id,
        media_type=row.media_type,
        title=detail.title,
        year=detail.year,
        poster_path=detail.poster_path,
        backdrop_path=detail.backdrop_path,
        rating=detail.rating,
        season_number=season_number,
        episode_number=episode_number,
        position_seconds=row.position_seconds,
        duration_seconds=row.duration_seconds,
    )


@router.get("/continue-watching", response_model=list[ContinueWatchingItemOut])
async def get_continue_watching(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await watch_progress_service.list_continue_watching(db, current_user.id)
    enriched = await asyncio.gather(*(_enrich(row) for row in rows))
    return [e for e in enriched if e is not None]
