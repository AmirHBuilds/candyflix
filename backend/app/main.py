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
Phase 7: Continue Watching — a home-page row (and a distinct
in-progress-series section) built entirely from a query over the
existing WatchProgress table; no new modeling work, same
enrich-at-read-time pattern as the watchlist.
"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    ai,
    announcements,
    account,
    admin,
    auth,
    continue_watching,
    errors,
    security,
    feedback,
    health,
    movies,
    opinions,
    resolve,
    playback,
    presence,
    ratings,
    search,
    segments,
    settings as settings_routes,
    site,
    subtitle_sync,
    subtitles,
    trending,
    tv,
    video_settings,
    watchlist,
)
from app.core.config import get_settings
from app.core.migrate import run_migrations
from app.core.security import SESSION_COOKIE_NAME
from app.services import auth_service
from app.services import error_log_service, login_guard_service, notice_service, telegram_service, two_factor_service

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


class SignedInOnlyFiles:
    """Videos and subtitle files are only served to someone with a valid session (profile pictures stay open:
    the sign-in screen shows them)."""

    PROTECTED = ("/mock-videos", "/subtitle-cache")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(self.PROTECTED) and scope["method"] != "OPTIONS":
            cookies = {}
            for name, value in scope.get("headers", []):
                if name == b"cookie":
                    for part in value.decode("latin-1").split(";"):
                        k, _, v = part.strip().partition("=")
                        cookies[k] = v
            token = cookies.get(SESSION_COOKIE_NAME)
            if not token or await auth_service.get_session_user_id(token) is None:
                await JSONResponse({"detail": "Not authenticated"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def _tidy_audio_forever():
    """Saved sync audio is deleted once it is older than SYNC_AUDIO_TTL_HOURS (checked now, then every hour)."""
    from app.services import subtitle_sync_service

    while True:
        try:
            subtitle_sync_service.cleanup_audio()
        except Exception:
            pass
        try:
            await error_log_service.cleanup()
            await notice_service.cleanup()
            await login_guard_service.cleanup()
        except Exception:
            pass
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_migrate:
        await run_migrations()
    error_log_service.install_log_handler()
    telegram_service.report_started()
    poller = asyncio.create_task(two_factor_service.poll_forever()) if telegram_service.enabled() else None
    tidy = asyncio.create_task(_tidy_audio_forever())
    try:
        yield
    finally:
        tidy.cancel()
        if poller:
            poller.cancel()


app = FastAPI(
    lifespan=lifespan,
    # The interactive API docs describe every route to anyone who asks, so they only exist in development.
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
    title=settings.app_name,
    description="Backend API for CandyFlix — a small, private movie & TV app.",
    version="0.1.0",
)

@app.exception_handler(Exception)
async def report_unhandled(request: Request, exc: Exception):
    where = f"{request.method} {request.url.path}"
    await error_log_service.record_now(
        error_log_service.source_for_path(request.url.path), f"{type(exc).__name__}: {str(exc)[:200]}",
        error_log_service.format_exception(exc), where=where,
    )
    return JSONResponse({"detail": "Internal Server Error"}, status_code=500)


@app.exception_handler(StarletteHTTPException)
async def report_server_answers(request: Request, exc: StarletteHTTPException):
    """A 5xx the code raised on purpose (the video service is down, the AI failed...) is a failure worth knowing about too."""
    if exc.status_code >= 500 and not getattr(exc, "logged", False):
        error_log_service.record(
            error_log_service.source_for_path(request.url.path), f"{exc.status_code}: {exc.detail}", None,
            where=f"{request.method} {request.url.path}",
        )
    return await http_exception_handler(request, exc)


app.add_middleware(SignedInOnlyFiles)
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
# Profile pictures: our own re-encoded WebP files under random names, so
# plain StaticFiles (cacheable) is right; the directory persists via the
# ./backend bind mount like the subtitle cache.
os.makedirs(settings.avatars_dir, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=settings.avatars_dir), name="avatars")
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
app.include_router(subtitle_sync.router, prefix="/api")
app.include_router(ratings.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(continue_watching.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(video_settings.router, prefix="/api")
app.include_router(site.router, prefix="/api")
app.include_router(segments.router, prefix="/api")
app.include_router(presence.router, prefix="/api")
app.include_router(announcements.router, prefix="/api")
app.include_router(opinions.router, prefix="/api")
app.include_router(resolve.router, prefix="/api")
app.include_router(security.router, prefix="/api")
app.include_router(errors.router, prefix="/api")
app.include_router(errors.admin_router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(feedback.admin_router, prefix="/api")


@app.get("/api")
async def root() -> dict:
    return {"message": f"{settings.app_name} API", "status": "running"}
