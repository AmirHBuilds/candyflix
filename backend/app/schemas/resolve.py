"""Schemas for the Candy Resolver integration (real video). See app/services/resolver_service.py."""
from typing import Literal

from pydantic import BaseModel


class StartIn(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int
    season_number: int | None = None
    episode_number: int | None = None


class DownloadIn(BaseModel):
    # None = "the best quality of the first source that found a video".
    stream_id: str | None = None


class StreamState(BaseModel):
    stream_id: str
    quality: str  # "1080p", "800p", "Auto"
    rank: int  # the number of lines for sorting; 0 for Auto
    # idle = not downloaded; downloading = being fetched (play_url may already work);
    # ready = fully downloaded; failed = the resolver gave up.
    state: Literal["idle", "downloading", "ready", "failed"]
    progress: float | None = None  # 0-100
    library_id: str | None = None
    play_url: str | None = None  # set once the video can be played (even while it still downloads)
    error: str | None = None


class SourceState(BaseModel):
    name: str
    starred: bool = False
    status: str  # the resolver's word: ok / error / running / ...
    error: str | None = None
    streams: list[StreamState]


class SubtitleItem(BaseModel):
    language: str
    label: str
    url: str
    format: Literal["srt", "vtt"] = "vtt"
    source: str | None = None
    default: bool = False


class ResolveState(BaseModel):
    task_id: str
    status: Literal["running", "done", "expired"]
    version: int
    sources_total: int
    sources_done: int
    # Place in the resolver's queue while the search waits for a free slot (None when not waiting).
    queue_position: int | None = None
    sources: list[SourceState]
    subtitles: list[SubtitleItem]
    # The stream that was started on its own (the first one downloaded), or None until there is one.
    auto_stream_id: str | None = None
