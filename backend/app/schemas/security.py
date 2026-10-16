"""Account-sharing overview and the admins' notices."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.site import LoginGuardConfig


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


class LoginBlockOut(BaseModel):
    scope: str  # "name" | "ip"
    key: str
    seconds_left: int
    since: datetime | None
    until: datetime | None
    fails: int
    minutes: int
    strikes: int
    others: list[str]  # name block: where the tries came from; address block: the names that were tried


class LoginEventOut(BaseModel):
    id: uuid.UUID
    at: datetime
    kind: str  # "failed" | "blocked"
    username: str | None
    ip: str | None
    detail: str | None


class NoTwoStep(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    is_admin: bool


class LoginsOverview(BaseModel):
    config: LoginGuardConfig
    blocks: list[LoginBlockOut]
    events: list[LoginEventOut]
    two_step_available: bool  # the server has a Telegram bot, so two-step sign-in can be offered
    without_two_step: list[NoTwoStep]
