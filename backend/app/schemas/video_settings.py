"""
Per-video player settings. Only keys listed here can be stored; anything
else is rejected (422) so a typo or a stale client can't litter the table.
Each key is optional, and `null` in a PATCH means "forget this one".
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_HEX = r"^#[0-9A-Fa-f]{6}$"

# The subtitle LOOK is one site-wide setting (settings.subtitles). Per video
# only the language and the timing are stored. STYLE_KEYS names the look keys:
# the settings route uses it, and older rows may still hold `subtitle_<key>`
# copies from a short-lived earlier design, which are ignored and cleaned up.
STYLE_KEYS = (
    "font_family", "font_size", "font_weight", "color", "background_color",
    "background_opacity", "outline", "outline_color", "shadow", "position", "align",
)
SUBTITLE_KEYS = tuple(f"subtitle_{k}" for k in STYLE_KEYS) + ("subtitle_language", "subtitle_offset")
LIVE_SUBTITLE_KEYS = ("subtitle_language", "subtitle_offset")


class VideoSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    volume: float | None = Field(default=None, ge=0, le=1)
    muted: bool | None = None
    # The subtitle language chosen for this video; "off" = captions off.
    subtitle_language: str | None = Field(default=None, min_length=2, max_length=10)
    # Timing correction in seconds (+ later, - earlier). Unbounded on purpose.
    subtitle_offset: float | None = Field(default=None, ge=-86400, le=86400)


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
