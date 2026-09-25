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
from app.services import subtitle_service, watch_progress_service

router = APIRouter(tags=["playback"])


@router.get("/playback/movie/{tmdb_id}", response_model=PlaybackSource)
async def playback_movie(
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        url = mock_provider.get_mock_video_url()
    except MockVideoNotConfigured as e:
        raise HTTPException(status_code=404, detail=str(e))

    default_track = await subtitle_service.get_default_english_track("movie", tmdb_id, None, None)

    progress = await watch_progress_service.get_progress(
        db, current_user.id, tmdb_id, "movie", None, None
    )
    return PlaybackSource(
        source_type="mock",
        url=url,
        subtitles=[default_track] if default_track else [],
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
        url = mock_provider.get_mock_video_url()
    except MockVideoNotConfigured as e:
        raise HTTPException(status_code=404, detail=str(e))

    default_track = await subtitle_service.get_default_english_track(
        "tv", tmdb_id, season_number, episode_number
    )

    progress = await watch_progress_service.get_progress(
        db, current_user.id, tmdb_id, "tv", season_number, episode_number
    )
    return PlaybackSource(
        source_type="mock",
        url=url,
        subtitles=[default_track] if default_track else [],
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


@router.get("/watch-progress/tv/{tmdb_id}/latest", response_model=WatchProgressOut | None)
async def get_latest_watch_progress_tv(
    tmdb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Backs the TV detail page's "Watch Now" button — the most recent
    episode this user has any progress on, or null if they've never
    started the show. No collision with the {season_number}/{episode_number}
    route above despite both starting with /watch-progress/tv/{tmdb_id}/:
    that route has two more path segments, this one has one, so they're
    structurally distinct regardless of declaration order."""
    row = await watch_progress_service.get_latest_progress_for_title(
        db, current_user.id, tmdb_id, "tv"
    )
    return watch_progress_service.to_watch_progress_out(row) if row else None


@router.get(
    "/watch-progress/tv/{tmdb_id}/season-progress",
    response_model=list[WatchProgressOut],
)
async def list_watch_progress_for_season(
    tmdb_id: int,
    season_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Backs the episode list's "you've seen this one" highlighting —
    every episode of this season with any saved progress.

    season_number is a query param, not a path segment, on purpose:
    /watch-progress/tv/{tmdb_id}/{season_number}/{episode_number} above
    already claims the "two more segments" shape, and FastAPI/Starlette
    matches routes by path structure at the string level (the `int` type
    hints only validate *after* a route structurally matches — they
    aren't compiled into the matching pattern unless you write
    `{name:int}` explicitly). A path route here, e.g. .../season/{n},
    would have the same two-segment shape as the episode route and could
    get matched by it first (then 422 on `int("season")`) depending on
    registration order. A query param sidesteps the ambiguity entirely.
    """
    rows = await watch_progress_service.list_progress_for_season(
        db, current_user.id, tmdb_id, season_number
    )
    return [watch_progress_service.to_watch_progress_out(row) for row in rows]
