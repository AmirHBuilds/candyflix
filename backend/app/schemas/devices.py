import uuid
from datetime import datetime

from pydantic import BaseModel


class DeviceOut(BaseModel):
    id: uuid.UUID
    label: str
    user_agent: str | None
    ip: str | None  # the address it last used
    country: str | None  # ISO code; "LAN" for a private address; None when unknown
    first_seen: datetime
    last_seen: datetime
    last_login_at: datetime
    sign_ins: int
    active: bool  # signed in right now
    sessions: int
    current: bool = False  # the device making this request


class DevicesOut(BaseModel):
    items: list[DeviceOut]
    active: int  # devices signed in now
    today: int  # different devices that signed in within 24 hours
    limits_on: bool
    max_per_day: int
    max_active: int
