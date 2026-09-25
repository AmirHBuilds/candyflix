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
from sqlalchemy.orm import aliased

from app.models.watch_progress import NO_EPISODE, NO_SEASON, WatchProgress
from app.schemas.playback import WatchProgressOut

# A title at/past this fraction of its duration is treated as finished,
# not "in progress" — Continue Watching (Phase 7) shouldn't resurface
# something the person already watched to the end. Chosen to match the
# common "credits are rolling" convention other players use; not
# user-configurable, since nobody has asked for that yet.
NEAR_COMPLETE_FRACTION = 0.95


def _to_sentinel(value: int | None, sentinel: int) -> int:
    return sentinel if value is None else value


def _from_sentinel(value: int, sentinel: int) -> int | None:
    return None if value == sentinel else value


def display_season_episode(row: WatchProgress) -> tuple[int | None, int | None]:
    """Public counterpart to the private sentinel helpers above, for any
    other module (e.g. the continue-watching route) that needs the
    honest None-for-movies season/episode representation without
    reaching into this module's private helpers — per this module's own
    docstring, nothing outside it should need to know the sentinel
    exists."""
    return (
        _from_sentinel(row.season_number, NO_SEASON),
        _from_sentinel(row.episode_number, NO_EPISODE),
    )


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


async def list_continue_watching(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 20
) -> list[WatchProgress]:
    """Returns the most-recently-updated WatchProgress row per
    (tmdb_id, media_type) for this user — i.e. one entry per title, with
    a series collapsed to its single most-recently-watched episode
    rather than listing every episode it has ever partially watched
    (a movie already has at most one row per the model's unique
    constraint, so this only actually collapses anything for TV).

    Uses Postgres's DISTINCT ON (via SQLAlchemy's `.distinct(*cols)`,
    which the Postgres dialect renders as DISTINCT ON) rather than a
    GROUP BY + subquery join — this project's Postgres dependency is
    already fixed, so there's no portability cost to taking the
    idiomatic path. DISTINCT ON requires its ORDER BY to start with the
    same columns it distincts on, so the "most recent episode wins" per
    title happens inside that first ordering; the outer query then
    re-sorts the (already deduplicated, one-per-title) result by
    recency across titles and applies the limit.

    Excludes anything at/past NEAR_COMPLETE_FRACTION of its own
    duration (see that constant) and any non-positive duration (which
    would otherwise divide by zero here and shouldn't exist as a real
    row regardless).
    """
    per_title = (
        select(WatchProgress)
        .where(
            WatchProgress.user_id == user_id,
            WatchProgress.duration_seconds > 0,
            (WatchProgress.position_seconds / WatchProgress.duration_seconds)
            < NEAR_COMPLETE_FRACTION,
        )
        .distinct(WatchProgress.tmdb_id, WatchProgress.media_type)
        .order_by(
            WatchProgress.tmdb_id,
            WatchProgress.media_type,
            WatchProgress.updated_at.desc(),
        )
        .subquery()
    )
    row = aliased(WatchProgress, per_title)
    result = await db.execute(select(row).order_by(row.updated_at.desc()).limit(limit))
    return list(result.scalars().all())
