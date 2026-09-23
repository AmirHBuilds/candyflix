"""
CandyFlix backend — FastAPI application entrypoint.

Phase 1: application skeleton, health checks, DB/Redis connectivity.
Phase 2: authentication (User model, sessions, login/logout).
Phase 3: TMDB integration (trending, search, movie/TV/season details).
Phase 5a: mock playback + watch progress (real custom player, resume
watching, subtitle rendering — against local mock video/subtitle
files, not any real/licensed source).
Phase 5b: online subtitle discovery via the OpenSubtitles REST API —
a real third-party integration (unlike playback sources, which stay
mock/local only by design; see providers/README.md).
Phase 5c: player polish (remembered volume/subtitle preferences,
cross-season episode rollover, sleep timer).
Phase 6: watchlist ("Candy Box") — add/remove/list, enriched with
live TMDB data at read time rather than storing a metadata copy.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, health, movies, playback, search, subtitles, trending, tv, watchlist
from app.core.config import get_settings

settings = get_settings()

# Created on startup (not committed — see .gitignore) so serving it
# doesn't 500 before a test video file has been dropped in.
os.makedirs(settings.mock_videos_dir, exist_ok=True)
# Populated on demand by the OpenSubtitles download endpoint (Phase 5b) —
# created up front for the same reason as the mock video dir above.
os.makedirs(settings.subtitle_cache_dir, exist_ok=True)


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
# Plain StaticFiles here (not NoCacheStaticFiles) — these are small,
# whole-file text downloads, not the range-requested video streams the
# Cache-Control workaround above exists for.
app.mount(
    "/subtitle-cache", StaticFiles(directory=settings.subtitle_cache_dir), name="subtitle-cache"
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(trending.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(movies.router, prefix="/api")
app.include_router(tv.router, prefix="/api")
app.include_router(playback.router, prefix="/api")
app.include_router(subtitles.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")


@app.get("/api")
async def root() -> dict:
    return {"message": f"{settings.app_name} API", "status": "running"}
