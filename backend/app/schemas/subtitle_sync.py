"""Schemas for Phase 11's subtitle sync."""
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.playback import SubtitleTrackOut


class SyncRequest(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int
    season_number: int | None = None
    episode_number: int | None = None
    # The resolver video being watched (needed for real video: its audio is what the subtitle is fitted to).
    library_id: str | None = Field(default=None, max_length=80)
    subtitle_url: str = Field(max_length=2000)  # the track's url, '/subtitle-cache/<file>.srt'
    language: str = Field(min_length=1, max_length=16)
    label: str = Field(min_length=1, max_length=60)


class SyncStatus(BaseModel):
    # idle: nothing started; queued/running: in progress (percent + message);
    # done: `track` is the synced subtitle; unchanged: it was already in sync;
    # failed: `message` says why, the original is untouched.
    state: Literal["idle", "queued", "running", "done", "unchanged", "failed"]
    percent: int = 0
    stage: str | None = None
    message: str | None = None
    track: SubtitleTrackOut | None = None
