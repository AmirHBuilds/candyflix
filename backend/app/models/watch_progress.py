"""
WatchProgress model.

One row per user per movie (or per user per episode, for TV). Powers
resume-watching in the player now, and will power the "Continue
Watching" home page row in Phase 7 — same underlying data.

IMPORTANT Postgres gotcha: for a movie, season_number/episode_number
don't apply. It's tempting to make them nullable and leave them NULL
for movies, but Postgres treats NULL as distinct from NULL in a unique
constraint — two "save progress" calls for the same movie would each
insert a new row instead of updating one, since NULL != NULL. We use a
sentinel value (-1) instead of NULL so the unique constraint actually
enforces "one row per user per title" the way it looks like it should.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

NO_SEASON = -1
NO_EPISODE = -1


class WatchProgress(Base):
    __tablename__ = "watch_progress"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "tmdb_id",
            "media_type",
            "season_number",
            "episode_number",
            name="uq_watch_progress_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "movie" | "tv"
    season_number: Mapped[int] = mapped_column(Integer, nullable=False, default=NO_SEASON)
    episode_number: Mapped[int] = mapped_column(Integer, nullable=False, default=NO_EPISODE)
    position_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return (
            f"<WatchProgress user_id={self.user_id} tmdb_id={self.tmdb_id} "
            f"media_type={self.media_type!r} s{self.season_number}e{self.episode_number} "
            f"pos={self.position_seconds}>"
        )
