"""
Watchlist ("Candy Box") service.
"""
import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.watchlist_item import WatchlistItem


async def add_item(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str) -> None:
    """Adding something already on the list is a no-op, not an error —
    the button that calls this doesn't need to know or care whether it
    was already there."""
    stmt = (
        insert(WatchlistItem)
        .values(user_id=user_id, tmdb_id=tmdb_id, media_type=media_type)
        .on_conflict_do_nothing(constraint="uq_watchlist_identity")
    )
    await db.execute(stmt)
    await db.commit()


async def remove_item(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str) -> None:
    """Removing something not on the list is likewise a no-op."""
    await db.execute(
        delete(WatchlistItem).where(
            WatchlistItem.user_id == user_id,
            WatchlistItem.tmdb_id == tmdb_id,
            WatchlistItem.media_type == media_type,
        )
    )
    await db.commit()


async def is_in_watchlist(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str) -> bool:
    result = await db.execute(
        select(WatchlistItem.id).where(
            WatchlistItem.user_id == user_id,
            WatchlistItem.tmdb_id == tmdb_id,
            WatchlistItem.media_type == media_type,
        )
    )
    return result.scalar_one_or_none() is not None


async def list_items(db: AsyncSession, user_id: uuid.UUID) -> list[WatchlistItem]:
    """Most recently added first."""
    result = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.user_id == user_id)
        .order_by(WatchlistItem.added_at.desc())
    )
    return list(result.scalars().all())
