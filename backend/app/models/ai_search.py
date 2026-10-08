"""What people asked Ask AI (Phase 14b): shown to admins on a person's page."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AISearch(Base):
    __tablename__ = "ai_searches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(String(400), nullable=False)
    results: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_history: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
