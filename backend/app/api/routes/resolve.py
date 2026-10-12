"""Real video through Candy Resolver (Phase 22). Everything needs a signed-in person."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.resolve import DownloadIn, ResolveState, StartIn
from app.services import resolver_service

router = APIRouter(prefix="/resolve", tags=["resolve"])


def _on() -> None:
    if not resolver_service.enabled():
        raise HTTPException(404, "Real video isn't set up on this server.")


@router.post("/start", response_model=ResolveState)
async def start(payload: StartIn, user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.start(user, payload.media_type, payload.tmdb_id, payload.season_number, payload.episode_number)


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


@router.get("/relay")
async def relay(request: Request, u: str = Query(..., max_length=4000), user: User = Depends(get_current_user)):
    _on()
    return await resolver_service.relay(u, request.headers.get("range"))
