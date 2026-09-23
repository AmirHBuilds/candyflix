"""
Schemas for the watchlist ("Candy Box") API.

WatchlistItemOut reuses the same shape as schemas/media.py's MediaItem
on purpose (tmdb_id, media_type, title, year, poster_path,
backdrop_path, rating) — it's the exact card shape the frontend's
existing media-grid components already know how to render, so the
Candy Box page needs no new card component.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class WatchlistAddRequest(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int


class WatchlistItemOut(BaseModel):
    tmdb_id: int
    media_type: str
    title: str
    year: str | None = None
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None
    added_at: datetime


class WatchlistStatusOut(BaseModel):
    in_watchlist: bool
