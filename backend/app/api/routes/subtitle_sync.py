"""
Subtitle sync routes (Phase 11).

POST starts (or joins) the sync for one subtitle of one video and returns its
status; GET returns the status — the player polls it, which is what lets the
progress bar survive a page refresh.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.subtitle_sync import SyncRequest, SyncStatus
from app.services import subtitle_sync_service as sync
from app.services.subtitle_sync_service import SyncError

router = APIRouter(tags=["subtitle-sync"])


@router.get("/subtitle-sync/status", response_model=SyncStatus)
async def sync_status(
    media_type: str,
    tmdb_id: int,
    subtitle_url: str,
    season_number: int | None = None,
    episode_number: int | None = None,
    current_user: User = Depends(get_current_user),
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")
    try:
        name = sync.subtitle_name_from_url(subtitle_url)
    except SyncError:
        return SyncStatus(state="idle")
    return await sync.get_status(sync.video_key(media_type, tmdb_id, season_number, episode_number), name)


@router.post("/subtitle-sync", response_model=SyncStatus)
async def start_sync(payload: SyncRequest, current_user: User = Depends(get_current_user)):
    try:
        name = sync.subtitle_name_from_url(payload.subtitle_url)
        vkey = sync.video_key(payload.media_type, payload.tmdb_id, payload.season_number, payload.episode_number)
        return await sync.start(vkey, name, payload.language, payload.label)
    except SyncError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
