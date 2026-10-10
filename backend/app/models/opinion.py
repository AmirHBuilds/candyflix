"""
Opinions: what people think of a title (or of one episode), replies to them, and likes.

Like the watchlist, rows hold identity only (who said what about which title); names and
posters are fetched from TMDB when shown. A season/episode of -1 means "the whole title".
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

WHOLE = -1


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Opinion(Base):
    __tablename__ = "opinions"
    __table_args__ = (Index("ix_opinions_title", "media_type", "tmdb_id", "season_number", "episode_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "movie" | "tv"
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False, default=WHOLE, server_default="-1")
    episode_number: Mapped[int] = mapped_column(Integer, nullable=False, default=WHOLE, server_default="-1")
    # A reply points at the opinion it answers (only one level deep).
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("opinions.id", ondelete="CASCADE"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Other people see "Someone"; admins can still see who wrote it.
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # An admin took it down without deleting it.
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)


class OpinionLike(Base):
    __tablename__ = "opinion_likes"
    __table_args__ = (UniqueConstraint("user_id", "opinion_id", name="uq_opinion_like"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    opinion_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("opinions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)


class TitleLike(Base):
    """"I liked this movie / show / episode"."""

    __tablename__ = "title_likes"
    __table_args__ = (
        UniqueConstraint("user_id", "media_type", "tmdb_id", "season_number", "episode_number", name="uq_title_like"),
        Index("ix_title_likes_title", "media_type", "tmdb_id", "season_number", "episode_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False, default=WHOLE, server_default="-1")
    episode_number: Mapped[int] = mapped_column(Integer, nullable=False, default=WHOLE, server_default="-1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
