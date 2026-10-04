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
