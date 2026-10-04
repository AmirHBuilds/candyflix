"""
VideoSettings — per-movie / per-episode player tweaks for one person
(volume, chosen subtitle language, later subtitle timing and look).

Sparse like UserSettings: a row holds only what was changed for that
video. Same sentinel trick as WatchProgress (-1 instead of NULL for
"no season/episode") so the uniqueness constraint really means one row
per person per video.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.watch_progress import NO_EPISODE, NO_SEASON


class VideoSettings(Base):
    __tablename__ = "video_settings"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "tmdb_id", "media_type", "season_number", "episode_number",
            name="uq_video_settings_identity",
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
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
