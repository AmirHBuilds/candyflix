"""Account-sharing overview and the admins' notices."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SharingIP(BaseModel):
    ip: str
    sign_ins: int
    first_at: datetime
    last_at: datetime
    devices: list[str]


class SharingPerson(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    is_disabled: bool = False
    distinct_ips: int
    sign_ins: int
    flagged: bool  # reached the limit in the window
    ips: list[SharingIP]


class SharingOverview(BaseModel):
    window_hours: int
    max_ips: int
    enabled: bool
    people: list[SharingPerson]


class NoticeOut(BaseModel):
    id: uuid.UUID
    at: datetime
    kind: str
    title: str
    body: str | None
    link: str | None
    user_id: uuid.UUID | None
    user_name: str | None
    unread: bool


class NoticesOut(BaseModel):
    items: list[NoticeOut]
    unread: int
    resting: bool
    rest_until: datetime | None
    rest_forever: bool
    server_time: datetime


class RestIn(BaseModel):
    minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 30)  # 0 = stop resting; None = until turned off
