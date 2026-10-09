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

    # Phase 12 — IMDb / Rotten Tomatoes / Metacritic scores on the detail pages,
    # from OMDb. Free key (1,000 requests a day): https://www.omdbapi.com/apikey.aspx
    # Without a key those scores are simply not shown (TMDB's own score still is).
    omdb_api_key: str = ""
    omdb_base_url: str = "https://www.omdbapi.com/"

    # Phase 14 — "Ask AI" search (Google Gemini). A free key from https://aistudio.google.com/apikey
    # works (the free tier: Google may use what is sent to improve its products, so only
    # titles and years are sent, never names). Without a key the feature stays hidden.
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_model: str = "gemini-3.5-flash"
    # Tried once when the main model is rate-limited or unavailable.
    gemini_fallback_model: str = "gemini-3.5-flash-lite"
    # AI searches per person per day; an admin can change it for one person, and admins have no limit.
    ai_default_daily_limit: int = 5
    # Questions to the watch assistant (the player's side panel) per person per day. Counted separately from AI searches.
    watch_ai_default_daily_limit: int = 20

    # Phase 17 — Telegram reports. Create a bot with @BotFather, add it to a group that has Topics
    # turned on (make it an admin), and put the group's chat id here (it starts with -100).
    # Each topic id is the number of the topic's first message / thread (see .env.example).
    # Anything left empty is simply not reported; with no token nothing is sent at all.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    telegram_topic_sign_ins: str = ""
    telegram_topic_accounts: str = ""
    telegram_topic_admin: str = ""
    telegram_topic_ai: str = ""
    telegram_topic_security: str = ""
    telegram_topic_errors: str = ""
    telegram_topic_system: str = ""
    telegram_base_url: str = "https://api.telegram.org"

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
    # Phase 11 — subtitle sync. Holds the "speech map" of each video (where
    # people talk), so syncing a second subtitle for the same video is instant.
    # Synced subtitles themselves are written into subtitle_cache_dir.
    sync_cache_dir: str = "sync-cache"

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
