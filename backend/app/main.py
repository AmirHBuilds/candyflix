"""
CandyFlix backend — FastAPI application entrypoint.

Phase 1: application skeleton, health checks, DB/Redis connectivity.
Phase 2: authentication (User model, sessions, login/logout).
Remaining feature routers (TMDB, playback, watchlist, progress) are
added in later phases per the approved implementation plan.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, health
from app.core.config import get_settings

settings = get_settings()

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

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")


@app.get("/api")
async def root() -> dict:
    return {"message": f"{settings.app_name} API", "status": "running"}
