"""Feedback sent from Settings, and the admins' view of it."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Kind = Literal["problem", "idea", "other"]


class FeedbackIn(BaseModel):
    kind: Kind = "idea"
    message: str = Field(min_length=1, max_length=2000)
    page: str | None = Field(default=None, max_length=200)

    @field_validator("message")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Write something first.")
        return v


class FeedbackOut(BaseModel):
    id: uuid.UUID
    kind: Kind
    message: str
    page: str | None
    device: str | None
    created_at: datetime
    handled: bool
    author_id: uuid.UUID | None
    author_name: str


class FeedbackPage(BaseModel):
    items: list[FeedbackOut]
    total: int
    unhandled: int
