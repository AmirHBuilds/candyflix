"""Schemas for Phase 12's external ratings (IMDb, Rotten Tomatoes, Metacritic)."""
from typing import Literal

from pydantic import BaseModel


class RatingOut(BaseModel):
    source: Literal["imdb", "rotten_tomatoes", "metacritic"]
    label: str  # "IMDb", "Rotten Tomatoes", "Metacritic"
    display: str  # "8.1", "94%", "82"
    suffix: str = ""  # "/10", "/100", "" (the % is part of display)
    value: float  # the number behind display, for sorting/tests
    votes: int | None = None
    url: str | None = None  # a page for this title on that site, when known


class RatingsOut(BaseModel):
    ratings: list[RatingOut]
    # False when no OMDb key is set, so the page can tell "no scores exist"
    # from "scores aren't switched on for this server".
    configured: bool
