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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
