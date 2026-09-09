"""
Media schemas.

These are CandyFlix's own normalized shapes — the frontend (and any
future metadata provider) never needs to know TMDB's raw response
structure. `tmdb_id` is the canonical external identifier per the
approved architecture; we don't store a local metadata duplicate.
"""
from pydantic import BaseModel


class MediaItem(BaseModel):
    """A trending/search/popular/similar result card."""

    tmdb_id: int
    media_type: str  # "movie" | "tv"
    title: str
    year: str | None = None
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None


class Genre(BaseModel):
    id: int
    name: str


class PagedMediaResponse(BaseModel):
    """Response shape for Load More / advanced search: TMDB's own page
    of up to 20 results, plus whether a further page exists. Unlike the
    home page sections, this deliberately does NOT try to guarantee a
    full multi-of-N count — each page is shown as TMDB returns it."""

    items: list[MediaItem]
    has_more: bool


class MovieDetail(BaseModel):
    tmdb_id: int
    title: str
    overview: str
    year: str | None = None
    genres: list[str] = []
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None
    runtime_minutes: int | None = None


class SeasonSummary(BaseModel):
    """A season as listed on the show's own detail page (no episodes yet)."""

    season_number: int
    name: str
    episode_count: int
    poster_path: str | None = None


class TVShowDetail(BaseModel):
    tmdb_id: int
    title: str
    overview: str
    year: str | None = None
    genres: list[str] = []
    poster_path: str | None = None
    backdrop_path: str | None = None
    rating: float | None = None
    seasons: list[SeasonSummary] = []


class Episode(BaseModel):
    episode_number: int
    name: str
    overview: str
    still_path: str | None = None
    air_date: str | None = None
    runtime_minutes: int | None = None


class SeasonDetail(BaseModel):
    tv_id: int
    season_number: int
    name: str
    episodes: list[Episode] = []
