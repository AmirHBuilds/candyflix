import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Lowercase letters, digits, dot, underscore, hyphen; 3-32 chars; must start
# with a letter or digit. Keeps names URL- and CLI-friendly and unambiguous.
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")


def _clean_username(value: str) -> str:
    value = value.strip().lower()
    if not USERNAME_RE.match(value):
        raise ValueError(
            "Username must be 3-32 characters: lowercase letters, numbers, '.', '_' or '-', "
            "starting with a letter or number."
        )
    return value


def _clean_display_name(value: str) -> str:
    value = " ".join(value.split())
    if not value:
        raise ValueError("Display name can't be empty")
    return value


class AdminUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    is_admin: bool
    is_disabled: bool
    created_at: datetime
    last_login_at: datetime | None = None
    avatar_url: str | None = None
    watchlist_count: int = 0
    watched_count: int = 0
    ai_daily_limit: int | None = None  # None = the site default
    watch_ai_daily_limit: int | None = None  # the same, for the watch assistant in the player
    ai_use_history: bool = True  # their own Settings switch: Ask AI may use their watch history


class AdminUserCreate(BaseModel):
    username: str
    display_name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    is_admin: bool = False

    @field_validator("username")
    @classmethod
    def _u(cls, v):
        return _clean_username(v)

    @field_validator("display_name")
    @classmethod
    def _d(cls, v):
        return _clean_display_name(v)


class AdminUserUpdate(BaseModel):
    """Every field optional: only what is sent changes."""

    username: str | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    is_admin: bool | None = None
    is_disabled: bool | None = None
    # Send null to go back to the site default; 0 switches AI search off for this person.
    ai_daily_limit: int | None = Field(default=None, ge=0, le=1000)
    watch_ai_daily_limit: int | None = Field(default=None, ge=0, le=1000)

    @field_validator("username")
    @classmethod
    def _u(cls, v):
        return None if v is None else _clean_username(v)

    @field_validator("display_name")
    @classmethod
    def _d(cls, v):
        return None if v is None else _clean_display_name(v)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class TopTitle(BaseModel):
    tmdb_id: int
    media_type: str
    title: str | None
    viewers: int


class DayActivity(BaseModel):
    date: str  # YYYY-MM-DD
    saves: int  # watch-progress saves that day
    active_users: int


class RecentLogin(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    last_login_at: datetime


class AdminStats(BaseModel):
    users_total: int
    admins: int
    disabled: int
    active_last_7_days: int
    watchlist_items: int
    watched_items: int
    activity: list[DayActivity]
    top_titles: list[TopTitle]
    recent_logins: list[RecentLogin]


class ServiceCheck(BaseModel):
    ok: bool
    detail: str
    latency_ms: int | None = None


class StorageInfo(BaseModel):
    files: int
    bytes: int


class SystemStatus(BaseModel):
    database: ServiceCheck
    redis: ServiceCheck
    tmdb: ServiceCheck
    opensubtitles: ServiceCheck
    omdb: ServiceCheck
    gemini: ServiceCheck
    subtitle_cache: StorageInfo
    avatars: StorageInfo
    app_version: str
    python_version: str
    auto_migrate: bool
    debug: bool


class ClearedResult(BaseModel):
    cleared: int


# ---------- Phase 10a: what people are watching ----------


class NowWatching(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    tmdb_id: int
    media_type: str
    season_number: int | None = None
    episode_number: int | None = None
    title: str | None = None
    poster_path: str | None = None
    position_seconds: float
    duration_seconds: float
    playing: bool
    since: datetime
    last_beat: datetime


class HistoryItem(BaseModel):
    tmdb_id: int
    media_type: str
    season_number: int | None = None
    episode_number: int | None = None
    title: str | None = None
    poster_path: str | None = None
    position_seconds: float
    duration_seconds: float
    # 0..1, or None when it was only opened (no position was saved).
    fraction: float | None = None
    opened_only: bool = False
    updated_at: datetime


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    total: int


class WatchlistEntry(BaseModel):
    tmdb_id: int
    media_type: str
    title: str | None = None
    poster_path: str | None = None
    added_at: datetime


class UserDetail(BaseModel):
    user: AdminUser
    now_watching: NowWatching | None = None
    active_sessions: int = 0
    last_activity: datetime | None = None


# ---------- Phase 10b: drill-down lists ----------


class TitleRow(BaseModel):
    tmdb_id: int
    media_type: str
    title: str | None = None
    poster_path: str | None = None
    viewers: int  # different people
    entries: int  # titles/episodes saved (a series counts each episode)
    last_watched_at: datetime


class TitlePage(BaseModel):
    items: list[TitleRow]
    total: int


class ViewerItem(HistoryItem):
    """One person's saved position on a title/episode (used for 'who watched this' and 'a day's activity')."""

    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None


class ViewerPage(BaseModel):
    items: list[ViewerItem]
    total: int


class LoginRow(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    is_disabled: bool = False
    last_login_at: datetime | None = None
    active_sessions: int = 0


# ---------- Phase 10d: audit trail ----------


class AuditEntry(BaseModel):
    id: uuid.UUID
    at: datetime
    actor_id: uuid.UUID | None = None
    actor_name: str
    action: str
    target_user_id: uuid.UUID | None = None
    target_name: str | None = None
    detail: str | None = None


class AuditPage(BaseModel):
    items: list[AuditEntry]
    total: int


class SignInEntry(BaseModel):
    id: uuid.UUID
    at: datetime
    user_id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    device: str


class SignInPage(BaseModel):
    items: list[SignInEntry]
    total: int


class AdminAIUser(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    is_admin: bool
    ai_daily_limit: int | None = None  # their own number; None = the usual
    effective_limit: int | None = None  # what applies today; None = unlimited
    used_today: int = 0
    watch_ai_daily_limit: int | None = None
    watch_effective_limit: int | None = None
    watch_used_today: int = 0
    use_history: bool = True


class AdminAIModel(BaseModel):
    model: str
    paused_seconds: int = 0  # > 0: out of quota, not being asked until then


class AdminAIOverview(BaseModel):
    key_configured: bool
    model: str
    enabled: bool
    default_daily_limit: int
    asks_today: int
    watch_enabled: bool = True
    watch_daily_limit: int = 20
    watch_asks_today: int = 0
    models: list[AdminAIModel] = []
    users: list[AdminAIUser]


class AdminAIConfigUpdate(BaseModel):
    enabled: bool
    default_daily_limit: int = Field(ge=0, le=1000)
    watch_enabled: bool = True
    watch_daily_limit: int = Field(default=20, ge=0, le=1000)


class AdminAIHistoryUpdate(BaseModel):
    use_history: bool


class AISearchRow(BaseModel):
    prompt: str
    results: int
    used_history: bool
    created_at: datetime


class AISearchPage(BaseModel):
    items: list[AISearchRow]
    total: int
