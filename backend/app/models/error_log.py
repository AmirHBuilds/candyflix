"""Error log: everything that went wrong, kept for the admins (and sent to Telegram)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ErrorLog(Base):
    __tablename__ = "error_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)  # first time
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)  # latest repeat
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    source: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # server | ai | resolver | sync | subtitles | browser | ...
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="error")  # "error" | "warning"
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # traceback or the raw answer
    where: Mapped[str | None] = mapped_column(String(300), nullable=True)  # "GET /api/..." or a page
    user_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    handled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
