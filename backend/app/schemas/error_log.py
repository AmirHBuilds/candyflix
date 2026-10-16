"""The error log as the admins see it, and what browsers may report."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ErrorLogOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen: datetime
    count: int
    source: str
    level: str
    title: str
    detail: str | None
    where: str | None
    user_name: str | None
    handled: bool


class ErrorLogPage(BaseModel):
    items: list[ErrorLogOut]
    total: int
    unhandled: int
    last_24h: int
    by_source: dict[str, int]  # unhandled, per source


class ClientErrorIn(BaseModel):
    message: str = Field(min_length=1, max_length=400)
    page: str | None = Field(default=None, max_length=200)
    detail: str | None = Field(default=None, max_length=3000)
    kind: str = Field(default="page", pattern="^(page|player)$")
