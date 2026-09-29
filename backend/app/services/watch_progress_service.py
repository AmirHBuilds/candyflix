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
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
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
        updated_at=row.updated_at,
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
    reflecting the latest position.

    Explicitly bumps updated_at in the upsert's SET clause. This is NOT
    redundant with the column's onupdate=... default on the model: that
    default is an ORM-level hook that only fires when SQLAlchemy's unit
    of work issues the UPDATE itself, and this is a raw Core
    on_conflict_do_update statement, which bypasses the ORM entirely — a
    real bug found here, where re-watching an already-saved episode
    silently left updated_at frozen at its very first save, forever.
    That in turn broke everything built on "most recently touched":
    list_continue_watching's ordering and, more visibly, SeasonBrowser's
    "In progress" episode on the frontend, which appeared permanently
    stuck on whichever episode happened to be touched first, no matter
    how many times a different one was rewatched afterward.
    """
    season = _to_sentinel(season_number, NO_SEASON)
    episode = _to_sentinel(episode_number, NO_EPISODE)
    now = datetime.now(timezone.utc)

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
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_watch_progress_identity",
            set_={
                "position_seconds": position_seconds,
                "duration_seconds": duration_seconds,
                "updated_at": now,
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


async def mark_episode_visited(
    db: AsyncSession,
    user_id: uuid.UUID,
    tmdb_id: int,
    season_number: int,
    episode_number: int,
) -> None:
    """Records "this episode was opened" without touching any real
    progress. Called when a watch page renders, before the video (or the
    player's own save logic) has had a chance to do anything.

    Why this exists: the player only saves once video metadata has loaded
    or playback has started, so clicking an episode and closing it within
    a second could leave no row at all — and the next visit would show
    the PREVIOUS episode as last watched, as if the click never happened.

    A brand-new row is created with position 0 and an unknown (0)
    duration; the player's own saves replace both as soon as it can. An
    existing row keeps its real position/duration and only has
    updated_at bumped — the bump is what lets "In progress" tell an
    episode you just went back to apart from one you merely moved past.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        insert(WatchProgress)
        .values(
            user_id=user_id,
            tmdb_id=tmdb_id,
            media_type="tv",
            season_number=season_number,
            episode_number=episode_number,
            position_seconds=0.0,
            duration_seconds=0.0,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_watch_progress_identity",
            set_={"updated_at": now},
        )
    )
    await db.execute(stmt)
    await db.commit()


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
    """One entry per title (tmdb_id, media_type) for this user. Each
    entry is that title's FURTHEST row — for TV the greatest
    (season_number, episode_number), the same high-water mark "Watch
    Now" resumes (see get_latest_progress_for_title) — NOT the most
    recently touched episode. Otherwise dipping into an early episode of
    a show you're deep into made the home page offer that early episode
    as where to continue, contradicting the detail page.

    Any row counts, however little was watched: opening a new episode
    makes it the furthest immediately (see mark_episode_visited), by
    design — someone who clicks the newest episode and closes it a second
    later should find that episode as their resume point next time, not
    the one before it.

    Titles are ordered by their most recent activity (any episode), so
    watching a bit of an earlier episode still floats the show to the
    front — it just keeps pointing at where you really are.

    The chosen row is dropped if it's at/past NEAR_COMPLETE_FRACTION of
    its own duration (finished, not "in progress"). A row with no known
    duration yet (a visit that never got as far as loading the video —
    see mark_episode_visited) can't be finished, so it stays.

    Uses Postgres's DISTINCT ON (SQLAlchemy's `.distinct(*cols)` on the
    Postgres dialect), which requires the ORDER BY to start with the
    same columns; "furthest wins" happens inside that ordering.
    """
    furthest = (
        select(WatchProgress)
        .where(WatchProgress.user_id == user_id)
        .distinct(WatchProgress.tmdb_id, WatchProgress.media_type)
        .order_by(
            WatchProgress.tmdb_id,
            WatchProgress.media_type,
            WatchProgress.season_number.desc(),
            WatchProgress.episode_number.desc(),
        )
        .subquery()
    )
    row = aliased(WatchProgress, furthest)

    activity = (
        select(
            WatchProgress.tmdb_id.label("tmdb_id"),
            WatchProgress.media_type.label("media_type"),
            func.max(WatchProgress.updated_at).label("last_activity"),
        )
        .where(WatchProgress.user_id == user_id)
        .group_by(WatchProgress.tmdb_id, WatchProgress.media_type)
        .subquery()
    )

    stmt = (
        select(row)
        .join(
            activity,
            and_(row.tmdb_id == activity.c.tmdb_id, row.media_type == activity.c.media_type),
        )
        .where(
            or_(
                row.duration_seconds <= 0,
                # NULLIF keeps the division from erroring for duration 0
                # rows, which Postgres would otherwise evaluate anyway.
                (row.position_seconds / func.nullif(row.duration_seconds, 0)) < NEAR_COMPLETE_FRACTION,
            )
        )
        .order_by(activity.c.last_activity.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_latest_progress_for_title(
    db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str
) -> WatchProgress | None:
    """The furthest-reached progress row for this title — for TV, the
    row with the greatest (season_number, episode_number), a high-water
    mark, NOT simply whichever row happened to be touched most recently.
    Backs the detail page's "Watch Now" button and the pink "resume
    point" highlighting in the episode list.

    This is a deliberate choice, not an oversight: someone who reaches
    S1E5 and later dips into an earlier episode (a rewatch, or just
    checking something) should still have "Watch Now" resume S1E5, not
    whatever they most recently clicked — the earlier episode instead
    becomes a candidate for the separate "In progress" indicator (see
    list_progress_for_season / SeasonBrowser's "secondary" concept),
    which is exactly the distinction a "most recently updated" query
    can't express: it would keep making the last-clicked episode "the"
    resume point regardless of whether it's actually ahead or behind.

    A movie only ever has one row (per the model's unique constraint),
    so this ordering is moot there — it's mechanically the same query
    get_progress() would run for a movie's single (NO_SEASON, NO_EPISODE)
    row.

    Any row counts, however little was watched: clicking a newer episode
    makes it "last watched" straight away, even if it's closed a second
    later (see mark_episode_visited) — otherwise the next visit would
    show the previous episode and look like the click never happened.

    Also deliberately does NOT apply NEAR_COMPLETE_FRACTION the way
    list_continue_watching() does — "how far have I gotten" is a
    different question from "should this clutter my in-progress rows,"
    and this is asking the former. A finished episode still answers
    "yes, and here's where," same as a half-watched one.
    """
    result = await db.execute(
        select(WatchProgress)
        .where(
            WatchProgress.user_id == user_id,
            WatchProgress.tmdb_id == tmdb_id,
            WatchProgress.media_type == media_type,
        )
        .order_by(WatchProgress.season_number.desc(), WatchProgress.episode_number.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_progress_for_season(
    db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, season_number: int
) -> list[WatchProgress]:
    """Every episode of this season the user has any saved progress for
    — including fully finished ones (again unlike
    list_continue_watching()'s exclusion): the episode list wants to
    mark "you've watched/started this" for anything with history,
    finished or not, not just what's still worth resuming."""
    result = await db.execute(
        select(WatchProgress).where(
            WatchProgress.user_id == user_id,
            WatchProgress.tmdb_id == tmdb_id,
            WatchProgress.media_type == "tv",
            WatchProgress.season_number == season_number,
        )
    )
    return list(result.scalars().all())
