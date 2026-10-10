"""
Pydantic schemas for authentication endpoints.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProfileEntry(BaseModel):
    """One tile on the public 'Who's watching?' screen. Minimal on purpose —
    it is visible to anyone who can load the login page. It does say who is
    an admin, because the picker shows admins with a crown (a private,
    invite-only app, so that is a choice, not a leak)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    created_at: datetime
    avatar_url: str | None = None
    is_admin: bool = False


class UserPublic(ProfileEntry):
    """The signed-in person's own account info — never includes password_hash."""


class LoginRequest(BaseModel):
    username: str
    password: str


class TwoFactorChallenge(BaseModel):
    """Said instead of signing in when the password was right but the account has two-step sign-in on."""

    two_factor_required: bool = True
    challenge: str


class TwoFactorVerify(BaseModel):
    challenge: str = Field(min_length=10, max_length=100)
    code: str = Field(min_length=4, max_length=10)


class TwoFactorResend(BaseModel):
    challenge: str = Field(min_length=10, max_length=100)
