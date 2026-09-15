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


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles that forbids browser caching of Range responses.

    Real bug this fixes: every "episode" in the mock provider resolves to the
    literal same physical video file, so the browser ends up issuing many
    different `Range` requests against the exact same URL within one session.
    Without an explicit Cache-Control header, browsers apply their own
    heuristic caching to 206 Partial Content responses — and that heuristic
    caching gets confused by repeated Range requests against one URL, at some
    point silently replaying a stale/mismatched cached response instead of
    hitting the network (visible in Chrome DevTools as "(from disk cache)").
    When that happens the video pipeline stalls waiting on data it wrongly
    believes it already has, with no new request ever reaching the server —
    which is exactly why these stalls never show up in the backend logs.
    Forcing `no-store` makes every Range request go to the network for real.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store"
        return response


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

app.mount("/mock-videos", NoCacheStaticFiles(directory=settings.mock_videos_dir), name="mock-videos")
app.mount(
    "/mock-subtitles", NoCacheStaticFiles(directory=settings.mock_subtitles_dir), name="mock-subtitles"
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
