"""Real video through Candy Resolver (Phase 22). Everything needs a signed-in person."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.resolve import DownloadIn, MoreIn, ResolveState, StartIn
from app.services import resolver_service, site_service

router = APIRouter(prefix="/resolve", tags=["resolve"])


def _on() -> None:
    if not resolver_service.enabled():
        raise HTTPException(404, "Real video isn't set up on this server.")


@router.post("/start", response_model=ResolveState)
async def start(payload: StartIn, user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.start(user, payload.media_type, payload.tmdb_id, payload.season_number, payload.episode_number)


@router.post("/prefetch")
async def prefetch(payload: StartIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Near the end of an episode the player asks for the next one to be got ready (if the admin allows it)."""
    _on()
    if not (await site_service.get_playback_config(db)).prefetch_next_episode:
        return {"started": False, "reason": "off"}
    started = await resolver_service.prefetch(user, payload.media_type, payload.tmdb_id, payload.season_number, payload.episode_number)
    return {"started": started}


@router.get("/tasks/{task_id}", response_model=ResolveState)
async def state(
    task_id: str,
    after: int | None = Query(None, ge=0),
    wait_s: int = Query(0, ge=0, le=25),
    user: User = Depends(get_current_user),
):
    _on()
    return await resolver_service.get_state(user, task_id, after, wait_s)


@router.post("/tasks/{task_id}/download", response_model=ResolveState)
async def download(task_id: str, payload: DownloadIn, user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.request_download(user, task_id, payload.stream_id)


@router.post("/tasks/{task_id}/more", response_model=ResolveState)
async def more(task_id: str, payload: MoreIn, user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.more_sources(user, task_id, payload.all)


@router.get("/relay")
async def relay(request: Request, u: str = Query(..., max_length=4000), user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.relay(u, request.headers.get("range"))
