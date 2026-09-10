"""
CandyFlix backend — FastAPI application entrypoint.

Phase 1: application skeleton, health checks, DB/Redis connectivity.
Phase 2: authentication (User model, sessions, login/logout).
Phase 3: TMDB integration (trending, search, movie/TV/season details).
Phase 5a: mock playback + watch progress (real custom player, resume
watching, subtitle rendering — against local mock video/subtitle
files, not any real/licensed source).
Remaining feature routers (watchlist, etc.) are added in later phases
per the approved implementation plan.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, health, movies, playback, search, trending, tv
from app.core.config import get_settings

settings = get_settings()

# Created on startup (not committed — see .gitignore) so serving them
# doesn't 500 before a test video/subtitle file has been dropped in.
os.makedirs(settings.mock_videos_dir, exist_ok=True)
os.makedirs(settings.mock_subtitles_dir, exist_ok=True)

app = FastAPI(
    title=settings.app_name,
    description="Backend API for CandyFlix — a small, private movie & TV app.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/mock-videos", StaticFiles(directory=settings.mock_videos_dir), name="mock-videos")
app.mount(
    "/mock-subtitles", StaticFiles(directory=settings.mock_subtitles_dir), name="mock-subtitles"
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(trending.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(movies.router, prefix="/api")
app.include_router(tv.router, prefix="/api")
app.include_router(playback.router, prefix="/api")


@app.get("/api")
async def root() -> dict:
    return {"message": f"{settings.app_name} API", "status": "running"}
