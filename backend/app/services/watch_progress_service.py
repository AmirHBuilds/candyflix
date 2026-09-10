"""
Watch-progress service.

Handles the None <-> sentinel(-1) conversion at the boundary: the API
and callers work with season_number/episode_number as None for movies
(the natural, honest representation), while the DB stores -1 (see the
comment on the WatchProgress model for why NULL doesn't work here for
the uniqueness constraint). Nothing outside this module should need to
know the sentinel exists.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.watch_progress import NO_EPISODE, NO_SEASON, WatchProgress
from app.schemas.playback import WatchProgressOut


def _to_sentinel(value: int | None, sentinel: int) -> int:
    return sentinel if value is None else value


def _from_sentinel(value: int, sentinel: int) -> int | None:
    return None if value == sentinel else value


def to_watch_progress_out(row: WatchProgress) -> WatchProgressOut:
    return WatchProgressOut(
        tmdb_id=row.tmdb_id,
        media_type=row.media_type,
        season_number=_from_sentinel(row.season_number, NO_SEASON),
        episode_number=_from_sentinel(row.episode_number, NO_EPISODE),
        position_seconds=row.position_seconds,
        duration_seconds=row.duration_seconds,
    )


async def save_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
    tmdb_id: int,
    media_type: str,
    season_number: int | None,
    episode_number: int | None,
    position_seconds: float,
    duration_seconds: float,
) -> WatchProgress:
    """Upserts by (user_id, tmdb_id, media_type, season_number,
    episode_number) — one row per user per title/episode, always
    reflecting the latest position."""
    season = _to_sentinel(season_number, NO_SEASON)
    episode = _to_sentinel(episode_number, NO_EPISODE)

    stmt = (
        insert(WatchProgress)
        .values(
            user_id=user_id,
            tmdb_id=tmdb_id,
            media_type=media_type,
            season_number=season,
            episode_number=episode,
            position_seconds=position_seconds,
            duration_seconds=duration_seconds,
        )
        .on_conflict_do_update(
            constraint="uq_watch_progress_identity",
            set_={
                "position_seconds": position_seconds,
                "duration_seconds": duration_seconds,
            },
        )
        .returning(WatchProgress)
    )
    result = await db.execute(stmt)
    await db.commit()
    row = result.scalar_one()
    # returning() gives us a fresh row from this statement, not attached
    # to the session's identity map in the usual way — re-fetch cleanly.
    await db.refresh(row)
    return row


async def get_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
    tmdb_id: int,
    media_type: str,
    season_number: int | None,
    episode_number: int | None,
) -> WatchProgress | None:
    season = _to_sentinel(season_number, NO_SEASON)
    episode = _to_sentinel(episode_number, NO_EPISODE)

    result = await db.execute(
        select(WatchProgress).where(
            WatchProgress.user_id == user_id,
            WatchProgress.tmdb_id == tmdb_id,
            WatchProgress.media_type == media_type,
            WatchProgress.season_number == season,
            WatchProgress.episode_number == episode,
        )
    )
    return result.scalar_one_or_none()
