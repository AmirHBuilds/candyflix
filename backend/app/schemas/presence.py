from typing import Literal

from pydantic import BaseModel, Field


class PresenceBeat(BaseModel):
    tmdb_id: int = Field(ge=1)
    media_type: Literal["movie", "tv"]
    season_number: int | None = Field(default=None, ge=0)
    episode_number: int | None = Field(default=None, ge=0)
    position_seconds: float = Field(ge=0, le=86400 * 2)
    duration_seconds: float = Field(ge=0, le=86400 * 2)
    playing: bool = True
