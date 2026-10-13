"""
Application configuration.

All configuration is sourced from environment variables (see .env.example).
Nothing sensitive is hard-coded here.
"""
from functools import lru_cache

from pydantic import model_validator
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
    # The audio taken from a downloaded video for syncing is kept this long (every person reuses it), then deleted.
    sync_audio_ttl_hours: int = 24

    # Intro / recap / credits timestamps (Phase 9f). SkipDB is asked first,
    # IntroDB fills in whatever it lacks. Both are open read APIs (no key).
    skipdb_base_url: str = "https://api.skipdb.tv"
    introdb_base_url: str = "https://api.introdb.app"

    # Phase 22 — Candy Resolver (finds and downloads the real video). Leave the URL or key
    # empty and the player falls back to the mock video folder.
    resolver_url: str = ""
    resolver_api_key: str = ""
    # How long the resolver keeps a downloaded video, in hours.
    resolver_ttl_hours: int = 24
    # "proxy": the browser talks only to CandyFlix, which relays the video from the resolver
    #          (works on localhost, no CORS needed on the resolver).
    # "direct": the browser plays the resolver's own link (needs CORS on the resolver; no relay cost).
    resolver_stream_mode: str = "proxy"
    # Extra hostnames the relay may fetch from (the resolver's own host is always allowed).
    resolver_extra_hosts: str = ""
    # How many seconds the first lookup waits for the first source (the resolver allows up to 30).
    resolver_first_wait_s: int = 25
    # Ask the resolver to start its starred (reliable) sources first.
    resolver_starred_first: bool = True
    # Downloads one person may start per minute.
    resolver_downloads_per_minute: int = 12
    # How many sources the first search asks (1 = only the best one; the menu's "Load more sources" asks for more).
    resolver_first_sources: int = 1
    # How many more sources "Load more" asks when the resolver can't say how many exist (the second click asks for all).
    resolver_more_default: int = 3
    # Audio taken from a downloaded video for subtitle sync: aac (fastest), mp3 or opus.
    resolver_audio_format: str = "aac"

    # Profile pictures (resized WebP files), served from /avatars.
    avatars_dir: str = "avatars"
    max_avatar_bytes: int = 5_000_000

    # Apply pending database migrations whenever the app starts. The
    # Docker entrypoint already does this on container start; this also
    # covers `uvicorn --reload`, which restarts the app *without* going
    # back through the entrypoint (so new migrations were being missed).
    auto_migrate: bool = True

    @model_validator(mode="after")
    def _production_is_safe(self):
        # A real deployment must never run with the placeholder secret: anyone could forge their way in.
        if self.environment == "production" and (self.session_secret in ("", "change-me-in-env") or len(self.session_secret) < 24):
            raise ValueError("Set SESSION_SECRET to a long random value (at least 24 characters) before running in production.")
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
