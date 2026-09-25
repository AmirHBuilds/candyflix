"""
Schemas for the home-page "Continue Watching" feature (Phase 7).

ContinueWatchingItemOut mirrors MediaItem's shape (see schemas/watchlist.py
for the same reasoning: it's what lets the frontend reuse its existing
MediaGrid/MediaCard rendering) plus the season/episode identity and raw
progress numbers needed to resume at the exact point and, for TV, show
an "S{season}:E{episode}" hint. Formatting that hint into a display
string is left to the frontend — this schema exposes raw identity, not
display text, consistent with "DB/API store identity, not display
data" (see PHASE_HANDOFF.md §3.3).
"""
from pydantic import BaseModel


class ContinueWatchingItemOut(BaseModel):
    tmdb_id: int
    media_type: str
    title: str
    year: str | None = None
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None
    season_number: int | None = None  # None for movies
    episode_number: int | None = None  # None for movies
    position_seconds: float
    duration_seconds: float


class ContinueWatchingListOut(BaseModel):
    """Envelope mirroring PagedMediaResponse (schemas/media.py) — same
    "items + has_more" shape, same reason: the caller (here, the home
    page vs. the "View All" page) needs to know whether there's more to
    show without a second round-trip just to find out."""

    items: list[ContinueWatchingItemOut]
    has_more: bool
