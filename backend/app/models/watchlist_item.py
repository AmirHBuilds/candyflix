"""
WatchlistItem model ("Candy Box").

One row per user per title — deliberately stores nothing but identity
(who saved what). No title/poster/etc. columns: display data is always
fetched fresh from TMDB when listing, the same "DB stores identity,
TMDB is the source of truth for anything display-related" split used
by WatchProgress. This also means a title that gets removed from TMDB
or renamed just reflects that naturally next time the list loads,
rather than the watchlist quietly going stale.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        UniqueConstraint("user_id", "tmdb_id", "media_type", name="uq_watchlist_identity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "movie" | "tv"
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    def __repr__(self) -> str:
        return f"<WatchlistItem user_id={self.user_id} tmdb_id={self.tmdb_id} media_type={self.media_type!r}>"
