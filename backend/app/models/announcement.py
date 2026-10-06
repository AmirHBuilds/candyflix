"""
Announcements — messages from the admin shown at the top of the site until
each person presses "I understand".

- `audience` "all" reaches every active person (including people added later);
  "selected" reaches only the people in `announcement_targets`.
- An acknowledgement is one row per person (`announcement_acks`), so the
  admin can see who accepted and when.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(String(10), nullable=False, default="all")  # "all" | "selected"
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The admin can stop showing a message without deleting it (and its acceptance record).
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())


class AnnouncementTarget(Base):
    __tablename__ = "announcement_targets"

    announcement_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("announcements.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class AnnouncementAck(Base):
    __tablename__ = "announcement_acks"

    announcement_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("announcements.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    acked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
