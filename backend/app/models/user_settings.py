"""
UserSettings model — one row per user holding their *explicit* settings.

The document is deliberately **sparse**: it stores only what the person
has actually changed (e.g. {"appearance": {"theme": "mint"}}), never a
full copy of every default. Defaults are merged in at read time
(see app/services/settings_service.py), so if a default is improved
later, everyone who never touched that setting gets the improvement
instead of being frozen on whatever the default was the day they signed
up. No row at all simply means "all defaults".
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

SETTINGS_SCHEMA_VERSION = 1


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Bumped only if the *shape* of the stored document ever has to be
    # migrated; today's rows are all version 1.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=SETTINGS_SCHEMA_VERSION)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<UserSettings user_id={self.user_id} keys={list(self.data)}>"
