"""What the admins are told while they are on the site (new feedback, an account used from many places), and each
admin's own state: what they have read and whether they are resting."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AdminNotice(Base):
    __tablename__ = "admin_notices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # "feedback" | "sharing"
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link: Mapped[str | None] = mapped_column(String(30), nullable=True)  # the admin tab it leads to
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name: Mapped[str | None] = mapped_column(String(100), nullable=True)


class AdminPref(Base):
    """One row per admin who has used notifications."""

    __tablename__ = "admin_prefs"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notices_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rest_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # resting until then
    rest_forever: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
