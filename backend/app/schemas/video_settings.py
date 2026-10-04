"""
Per-video player settings. Only keys listed here can be stored; anything
else is rejected (422) so a typo or a stale client can't litter the table.
Each key is optional, and `null` in a PATCH means "forget this one".
"""
from pydantic import BaseModel, ConfigDict, Field


class VideoSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    volume: float | None = Field(default=None, ge=0, le=1)
    muted: bool | None = None
    # The subtitle language chosen for this video; "off" = captions off.
    subtitle_language: str | None = Field(default=None, min_length=2, max_length=10)


class ClearedResult(BaseModel):
    cleared: int
