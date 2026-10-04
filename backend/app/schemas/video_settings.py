"""
Per-video player settings. Only keys listed here can be stored; anything
else is rejected (422) so a typo or a stale client can't litter the table.
Each key is optional, and `null` in a PATCH means "forget this one".
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_HEX = r"^#[0-9A-Fa-f]{6}$"

# Style keys that can be overridden for one video. Each is the global
# Settings -> Subtitles key with a `subtitle_` prefix; a change to the global
# one clears the override (see video_settings_service.clear_keys).
STYLE_KEYS = (
    "font_family", "font_size", "font_weight", "color", "background_color",
    "background_opacity", "outline", "outline_color", "shadow", "position", "align",
)
SUBTITLE_KEYS = tuple(f"subtitle_{k}" for k in STYLE_KEYS) + ("subtitle_language", "subtitle_offset")


class VideoSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    volume: float | None = Field(default=None, ge=0, le=1)
    muted: bool | None = None
    # The subtitle language chosen for this video; "off" = captions off.
    subtitle_language: str | None = Field(default=None, min_length=2, max_length=10)
    # Timing correction in seconds (+ later, - earlier). Unbounded on purpose.
    subtitle_offset: float | None = Field(default=None, ge=-86400, le=86400)
    subtitle_font_family: str | None = Field(default=None, min_length=1, max_length=120)
    subtitle_font_size: int | None = Field(default=None, ge=10, le=64)
    subtitle_font_weight: int | None = Field(default=None, ge=100, le=900)
    subtitle_color: str | None = Field(default=None, pattern=_HEX)
    subtitle_background_color: str | None = Field(default=None, pattern=_HEX)
    subtitle_background_opacity: float | None = Field(default=None, ge=0, le=1)
    subtitle_outline: bool | None = None
    subtitle_outline_color: str | None = Field(default=None, pattern=_HEX)
    subtitle_shadow: bool | None = None
    subtitle_position: Literal["bottom", "top"] | None = None
    subtitle_align: Literal["left", "center", "right"] | None = None


class ClearedResult(BaseModel):
    cleared: int


class SubtitleOverride(BaseModel):
    """One video that has its own subtitle settings, for the review list."""

    media_type: Literal["movie", "tv"]
    tmdb_id: int
    season_number: int | None = None
    episode_number: int | None = None
    title: str | None = None
    settings: dict
    updated_at: str | None = None
