"""
Pydantic schemas for authentication endpoints.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProfileEntry(BaseModel):
    """One tile on the public 'Who's watching?' screen. Deliberately
    minimal — it is visible to anyone who can load the login page, so it
    must not reveal roles or anything else about the account."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    created_at: datetime
    avatar_url: str | None = None


class UserPublic(ProfileEntry):
    """The signed-in person's own account info — never includes password_hash."""

    is_admin: bool = False


class LoginRequest(BaseModel):
    username: str
    password: str
