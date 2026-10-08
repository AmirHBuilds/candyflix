"""Ask AI: what the page sends and gets back."""
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
