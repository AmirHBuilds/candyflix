"""
Playback & watch-progress schemas.

PlaybackSource is intentionally provider-agnostic: source_type is
"mock" today, with "embed" and "hls" reserved for future phases (legit
external links, or a self-hosted Candy Server). The player component
should only ever branch on source_type, never assume "mock".
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SubtitleTrackOut(BaseModel):
    language: str  # e.g. "en" — drives the menu label and <track> lang attr
    label: str  # human-readable, e.g. "English"
    url: str
    format: Literal["srt", "vtt"]  # frontend converts srt -> vtt before use


class PlaybackSource(BaseModel):
    source_type: Literal["mock"]
    url: str
    subtitles: list[SubtitleTrackOut]
    resume_position_seconds: float | None = None


class WatchProgressIn(BaseModel):
    tmdb_id: int
    media_type: Literal["movie", "tv"]
    season_number: int | None = None  # None for movies
    episode_number: int | None = None  # None for movies
    position_seconds: float
    duration_seconds: float


class WatchProgressOut(BaseModel):
    tmdb_id: int
    media_type: Literal["movie", "tv"]
    season_number: int | None
    episode_number: int | None
    position_seconds: float
    duration_seconds: float
    # Exposed so a client can rank several episodes of saved progress by
    # recency itself (e.g. the TV detail page picking which non-resume
    # episode is worth flagging as "In progress") without a second,
    # more specific endpoint for every such ranking need.
    updated_at: datetime

    model_config = {"from_attributes": True}
