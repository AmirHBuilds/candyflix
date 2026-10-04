"""Skippable parts of a video (intro, recap, credits), in seconds."""
from typing import Literal

from pydantic import BaseModel

Provider = Literal["skipdb", "introdb"]


class Segment(BaseModel):
    start: float
    end: float
    source: Provider


class SegmentsOut(BaseModel):
    intro: Segment | None = None
    recap: Segment | None = None
    credits: Segment | None = None
