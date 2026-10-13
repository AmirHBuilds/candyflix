"""Feedback: what people write to the admins from Settings."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)  # kept even if the account is deleted
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="idea")  # "problem" | "idea" | "other"
    message: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[str | None] = mapped_column(String(200), nullable=True)  # where they were when they wrote it
    device: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    handled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
