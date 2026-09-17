"""
Schemas for Phase 5b's online subtitle discovery (OpenSubtitles).

Kept separate from schemas/playback.py: SubtitleTrackOut there is the
shape the *player* consumes (whatever the source — mock files or an
OpenSubtitles download, once cached, look identical to it). The types
here are specific to the search/download round-trip itself.
"""
from typing import Literal

from pydantic import BaseModel


class OnlineSubtitleResult(BaseModel):
    file_id: int  # OpenSubtitles file id — pass back as-is to /subtitles/download
    language: str  # e.g. "en"
    label: str  # human-readable, e.g. "English"
    release: str | None = None  # uploader's release name, e.g. "Movie.Title.2023.WEBRip"
    downloads: int = 0
    rating: float | None = None
    hearing_impaired: bool = False


class OnlineSubtitleDownloadRequest(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int
    season_number: int | None = None
    episode_number: int | None = None
    file_id: int
    language: str
    label: str
