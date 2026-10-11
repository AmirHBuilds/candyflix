"""Opinions (what people think of a title or episode), replies and likes."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

MediaKind = Literal["movie", "tv"]


class Scope(BaseModel):
    """What an opinion or like is about. Season/episode -1 = the whole title."""

    media_type: MediaKind
    tmdb_id: int = Field(gt=0)
    season_number: int = Field(default=-1, ge=-1, le=1000)
    episode_number: int = Field(default=-1, ge=-1, le=10000)

    @field_validator("episode_number")
    @classmethod
    def _episode_needs_season(cls, v, info):
        if v >= 0 and info.data.get("season_number", -1) < 0:
            raise ValueError("An episode needs its season.")
        return v


class OpinionCreate(Scope):
    body: str = Field(min_length=1, max_length=500)
    anonymous: bool = False
    parent_id: uuid.UUID | None = None

    @field_validator("body")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = "\n".join(line.rstrip() for line in v.strip().splitlines())
        if not v:
            raise ValueError("Write something first.")
        return v


class Person(BaseModel):
    id: uuid.UUID
    name: str
    avatar_url: str | None = None


class OpinionOut(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime
    author: Person | None  # None when it was posted anonymously
    is_anonymous: bool
    mine: bool
    likes: int = 0
    liked_by_me: bool = False
    # Where it was written: -1 = about the whole title, otherwise a season/episode of a show.
    season_number: int = -1
    episode_number: int = -1
    # Only admins ever get these two.
    real_author: str | None = None
    hidden: bool = False
    replies: list["OpinionOut"] = []


class LikeSummary(BaseModel):
    count: int = 0  # people who liked it and share their likes, plus you
    you_liked: bool = False
    people: list[Person] = []  # the most recent few (not you)
    more: int = 0  # more people beyond `people`


class TitleOpinions(BaseModel):
    enabled: bool  # opinions are on for you and for the site
    moderator: bool = False  # you are an admin: you may hide/delete anything
    can_comment: bool = False
    why_not: str | None = None
    allow_anonymous: bool = True
    allow_replies: bool = True
    anonymous_default: bool = False
    likes: LikeSummary = LikeSummary()
    comment_count: int = 0  # every visible opinion and reply (for a whole show: its episodes' too)
    opinions: list[OpinionOut] = []


class LikeSet(Scope):
    liked: bool


class LikeResult(BaseModel):
    likes: LikeSummary


class OpinionLikeResult(BaseModel):
    likes: int
    liked_by_me: bool


class Latest(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime
    author: Person | None
    season_number: int = -1
    episode_number: int = -1


class FeedTitle(BaseModel):
    """Everything the family did on one title, as one card: the newest opinion, how many more, and who liked it."""

    media_type: MediaKind
    tmdb_id: int
    title: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    latest: Latest | None = None
    comment_count: int = 0  # every opinion and reply, yours included
    other_comment_count: int = 0  # the ones by other people (the card never features yours)
    likes: LikeSummary = LikeSummary()  # count includes your own like; people/more are other people only


class Feed(BaseModel):
    enabled: bool
    items: list[FeedTitle] = []


class AdminOpinion(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime
    author_id: uuid.UUID
    author_name: str
    is_anonymous: bool
    hidden: bool
    is_reply: bool
    media_type: MediaKind
    tmdb_id: int
    season_number: int
    episode_number: int
    title: str | None = None
    likes: int = 0


class AdminOpinionPage(BaseModel):
    items: list[AdminOpinion]
    total: int


OpinionOut.model_rebuild()
