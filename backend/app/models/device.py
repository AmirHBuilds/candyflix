"""A browser or phone a person has signed in from (kept after the sign-in ends, so the history survives)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "device_id", name="uq_devices_user_device"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)  # the random value in the device cookie
    label: Mapped[str] = mapped_column(String(100), nullable=False)  # "Chrome on Windows"
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    first_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    last_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    country: Mapped[str | None] = mapped_column(String(3), nullable=True)  # ISO code of the last address, "LAN" for a private one
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)  # last time it used the site
    last_login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)  # last time it signed in
    sign_ins: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
