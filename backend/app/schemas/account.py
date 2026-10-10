from pydantic import BaseModel, Field, field_validator


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=50)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = " ".join(value.split())  # trims and collapses runs of spaces
        if not value:
            raise ValueError("Display name can't be empty")
        return value


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class TwoFactorStatus(BaseModel):
    available: bool  # the server has a Telegram bot set up
    enabled: bool


class TwoFactorStart(BaseModel):
    password: str


class TwoFactorLink(BaseModel):
    url: str


class TwoFactorOff(BaseModel):
    password: str
