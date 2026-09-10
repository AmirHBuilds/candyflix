"""
Playback source & watch-progress routes.

All routes here are auth-protected — playback progress is inherently
per-user (Candy, Mom, and Sister never see each other's positions).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.providers import mock_provider
from app.providers.mock_provider import MockVideoNotConfigured
from app.schemas.playback import PlaybackSource, WatchProgressIn, WatchProgressOut
from app.services import watch_progress_service

router = APIRouter(tags=["playback"])


@router.get("/playback/movie/{tmdb_id}", response_model=PlaybackSource)
async def playback_movie(
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        url, subtitles = mock_provider.get_mock_playback()
    except MockVideoNotConfigured as e:
        raise HTTPException(status_code=404, detail=str(e))

    progress = await watch_progress_service.get_progress(
        db, current_user.id, tmdb_id, "movie", None, None
    )
    return PlaybackSource(
        source_type="mock",
        url=url,
        subtitles=subtitles,
        resume_position_seconds=progress.position_seconds if progress else None,
    )


@router.get("/playback/tv/{tmdb_id}/{season_number}/{episode_number}", response_model=PlaybackSource)
async def playback_episode(
    tmdb_id: int,
    season_number: int,
    episode_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        url, subtitles = mock_provider.get_mock_playback()
    except MockVideoNotConfigured as e:
        raise HTTPException(status_code=404, detail=str(e))

    progress = await watch_progress_service.get_progress(
        db, current_user.id, tmdb_id, "tv", season_number, episode_number
    )
    return PlaybackSource(
        source_type="mock",
        url=url,
        subtitles=subtitles,
        resume_position_seconds=progress.position_seconds if progress else None,
    )


@router.post("/watch-progress", response_model=WatchProgressOut)
async def save_watch_progress(
    payload: WatchProgressIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await watch_progress_service.save_progress(
        db,
        current_user.id,
        payload.tmdb_id,
        payload.media_type,
        payload.season_number,
        payload.episode_number,
        payload.position_seconds,
        payload.duration_seconds,
    )
    return watch_progress_service.to_watch_progress_out(row)


@router.get("/watch-progress/movie/{tmdb_id}", response_model=WatchProgressOut | None)
async def get_watch_progress_movie(
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await watch_progress_service.get_progress(db, current_user.id, tmdb_id, "movie", None, None)
    return watch_progress_service.to_watch_progress_out(row) if row else None


@router.get(
    "/watch-progress/tv/{tmdb_id}/{season_number}/{episode_number}",
    response_model=WatchProgressOut | None,
)
async def get_watch_progress_episode(
    tmdb_id: int,
    season_number: int,
    episode_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await watch_progress_service.get_progress(
        db, current_user.id, tmdb_id, "tv", season_number, episode_number
    )
    return watch_progress_service.to_watch_progress_out(row) if row else None
