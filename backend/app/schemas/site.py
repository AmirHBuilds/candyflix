"""Footer content shown on every page; edited by admins."""
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

_URL = re.compile(r"^(https?://|mailto:|/)\S+$", re.IGNORECASE)
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class FooterLink(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=40)
    url: str = Field(max_length=300)

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Link label can't be empty")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if not _URL.match(v):
            raise ValueError("Link must start with http://, https://, mailto: or /")
        return v


class Footer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    tagline: str = Field(default="Your own private movie night.", max_length=160)
    email: str = Field(default="", max_length=120)
    links: list[FooterLink] = Field(default_factory=list, max_length=8)
    copyright: str = Field(default="CandyFlix", max_length=80)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip()
        if v and not _EMAIL.match(v):
            raise ValueError("That doesn't look like an email address")
        return v

    @field_validator("tagline", "copyright")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class Banner(BaseModel):
    """One of the three feature banners on the home page. The picture is fixed per slot; the words are the admin's."""

    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    title: str = Field(default="", max_length=60)
    text: str = Field(default="", max_length=220)

    @field_validator("title", "text")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


DEFAULT_BANNERS = [
    Banner(
        title="Subtitles that fit",
        text="Pick a subtitle from OpenSubtitles, then tap Sync and CandyFlix lines it up with the video's audio. It remembers the fixed one for next time.",
    ),
    Banner(
        title="Right where you left off",
        text="Resume any movie or episode from the same spot, skip intros with one tap, and keep your own CandyBox of things to watch.",
    ),
    Banner(
        title="Make it yours",
        text="Pick a colour theme, arrange the player's buttons, peek at every rating, and watch a trailer before you commit to movie night.",
    ),
]


class HomeBanners(BaseModel):
    model_config = ConfigDict(extra="forbid")
    banners: list[Banner] = Field(default_factory=lambda: [b.model_copy() for b in DEFAULT_BANNERS], min_length=3, max_length=3)

    @field_validator("banners")
    @classmethod
    def _enabled_ones_need_words(cls, v: list[Banner]) -> list[Banner]:
        for b in v:
            if b.enabled and not (b.title and b.text):
                raise ValueError("A banner that is switched on needs a title and some text")
        return v
