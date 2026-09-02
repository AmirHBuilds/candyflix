"""
Pydantic schemas for authentication endpoints.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserPublic(BaseModel):
    """Safe-to-expose user info — never includes password_hash."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    created_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str
