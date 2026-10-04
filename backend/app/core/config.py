"""
Application configuration.

All configuration is sourced from environment variables (see .env.example).
Nothing sensitive is hard-coded here.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # General
    app_name: str = "CandyFlix"
    environment: str = "development"
    debug: bool = True

    # Database
    database_url: str = "postgresql+asyncpg://candyflix:candyflix@localhost:5432/candyflix"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # TMDB (used starting Phase 2 — present now so config wiring is complete)
    tmdb_api_key: str = ""
    tmdb_base_url: str = "https://api.themoviedb.org/3"

    # Session / auth secret (used starting Phase 2)
    session_secret: str = "change-me-in-env"

    # CORS
    frontend_origin: str = "http://localhost:3000"

    # Phase 5 — mock playback (a folder you drop a test video into; gitignored)
    mock_videos_dir: str = "mock-videos"

    # Phase 5b — online subtitle discovery (OpenSubtitles REST API).
    # Free API key from https://www.opensubtitles.com/en/consumers — required
    # for search/download to work at all. Username/password are technically
    # optional, but OpenSubtitles has a history of throttling/rejecting
    # key-only requests — set these too (same account as the API key) if
    # search/download come back with 401/403/429. Downloaded files are
    # cached in subtitle_cache_dir so the same (title, season, episode,
    # language) is never re-downloaded, since the daily download quota
    # is small either way.
    opensubtitles_api_key: str = ""
    opensubtitles_user_agent: str = "CandyFlix v1.0"
    opensubtitles_username: str = ""
    opensubtitles_password: str = ""
    subtitle_cache_dir: str = "subtitle-cache"

    # Intro / recap / credits timestamps (Phase 9f). SkipDB is asked first,
    # IntroDB fills in whatever it lacks. Both are open read APIs (no key).
    skipdb_base_url: str = "https://api.skipdb.tv"
    introdb_base_url: str = "https://api.introdb.app"

    # Profile pictures (resized WebP files), served from /avatars.
    avatars_dir: str = "avatars"
    max_avatar_bytes: int = 5_000_000

    # Apply pending database migrations whenever the app starts. The
    # Docker entrypoint already does this on container start; this also
    # covers `uvicorn --reload`, which restarts the app *without* going
    # back through the entrypoint (so new migrations were being missed).
    auto_migrate: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
