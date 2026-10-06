"""/api/presence — the player's "I'm watching this" heartbeat (see presence_service)."""
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.presence import PresenceBeat
from app.services import presence_service

router = APIRouter(prefix="/presence", tags=["presence"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(payload: PresenceBeat, user: User = Depends(get_current_user)):
    if payload.media_type == "tv" and (payload.season_number is None or payload.episode_number is None):
        raise HTTPException(status_code=422, detail="A TV episode needs season_number and episode_number.")
    season = episode = None
    if payload.media_type == "tv":
        season, episode = payload.season_number, payload.episode_number
    await presence_service.beat(
        user.id,
        tmdb_id=payload.tmdb_id,
        media_type=payload.media_type,
        season_number=season,
        episode_number=episode,
        position_seconds=payload.position_seconds,
        duration_seconds=payload.duration_seconds,
        playing=payload.playing,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# A POST (not DELETE) so the browser's sendBeacon can call it as the page closes.
@router.post("/stop", status_code=status.HTTP_204_NO_CONTENT)
async def stop(user: User = Depends(get_current_user)):
    await presence_service.stop(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
