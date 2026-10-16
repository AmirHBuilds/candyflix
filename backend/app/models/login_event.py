"""Failed sign-ins and the blocks they caused (kept 30 days, shown to admins in the Security tab)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LoginEvent(Base):
    __tablename__ = "login_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    kind: Mapped[str] = mapped_column(String(12), nullable=False, index=True)  # "failed" | "blocked"
    username: Mapped[str | None] = mapped_column(String(100), nullable=True)  # the name that was tried
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True, index=True)
    detail: Mapped[str | None] = mapped_column(String(200), nullable=True)
