"""Ask AI: what the page sends and gets back."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AskRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=400)

    @field_validator("prompt")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Say a little more about what you'd like to watch")
        return v


class AskTitle(BaseModel):
    """A suggestion, with what the detail page shows so a row can look like one."""

    tmdb_id: int
    media_type: str  # "movie" | "tv"
    title: str
    year: str | None = None
    overview: str = ""
    genres: list[str] = []
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None
    runtime_minutes: int | None = None
    seasons: int | None = None
    trailer_key: str | None = None
    reason: str | None = None  # the AI's one-line why


class AskResponse(BaseModel):
    note: str | None = None
    for_you: list[AskTitle] = []
    general: list[AskTitle] = []
    used_history: bool = False
    # None = no limit (admins)
    remaining: int | None = None
    limit: int | None = None


class AIStatus(BaseModel):
    enabled: bool
    limit: int | None = None  # None = unlimited
    used: int = 0
    remaining: int | None = None


class WatchTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=3000)
    # Where the video was when a user turn was sent (seconds).
    position_seconds: float | None = Field(default=None, ge=0, le=86400)


class WatchAskRequest(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int = Field(gt=0)
    season_number: int | None = Field(default=None, ge=0, le=1000)
    episode_number: int | None = Field(default=None, ge=0, le=10000)
    question: str = Field(min_length=1, max_length=400)
    position_seconds: float = Field(default=0, ge=0, le=86400)
    intent: Literal["ask", "recap_all", "recap_so_far", "just_happened", "previously"] = "ask"
    history: list[WatchTurn] = Field(default_factory=list, max_length=10)


class WatchAskResponse(BaseModel):
    answer: str
    has_dialogue: bool = False  # False: answered from the title's description only
    remaining: int | None = None
    limit: int | None = None
