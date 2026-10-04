"""
User model.

CandyFlix is a small, private, multi-user application (Candy, and a
handful of people close to her). There is deliberately no email or
self-service signup — people are created by an admin (or the CLI).
The only role is `is_admin`: admins can manage other users and see the
admin panel; everyone else just has their own library and settings.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(
        String(50), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # A filename inside settings.avatars_dir (a resized WebP), or None.
    avatar_path: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Admins can switch an account off without deleting its data: it can't
    # log in and any session it already has stops working immediately.
    is_disabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # Stamped on every successful login; shown in the admin panel.
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def avatar_url(self) -> str | None:
        """Where the picture is served (a path on this backend), or None."""
        return f"/avatars/{self.avatar_path}" if self.avatar_path else None

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"
