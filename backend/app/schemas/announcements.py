import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Audience = Literal["all", "selected"]


def _clean(value: str) -> str:
    return value.strip()


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)
    audience: Audience = "all"
    user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    expires_at: datetime | None = None

    _strip = field_validator("title", "body", mode="after")(_clean)

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v:
            raise ValueError("Can't be empty.")
        return v


class AnnouncementUpdate(BaseModel):
    """Every field optional; `expires_at: null` means "never expires"."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    audience: Audience | None = None
    user_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)
    expires_at: datetime | None = None
    is_active: bool | None = None

    @field_validator("title", "body", mode="after")
    @classmethod
    def _strip_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Can't be empty.")
        return v


class AnnouncementOut(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    audience: Audience
    created_at: datetime
    created_by_name: str | None = None
    expires_at: datetime | None = None
    is_active: bool
    status: Literal["active", "expired", "stopped"]
    recipients: int
    accepted: int


class Recipient(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    acked_at: datetime | None = None


class AnnouncementDetail(AnnouncementOut):
    people: list[Recipient]


class PendingAnnouncement(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    created_at: datetime
