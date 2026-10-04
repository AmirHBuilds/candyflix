"""
/api/segments — where a video's intro, recap and credits are (Phase 9f).

Auth-protected like the other playback routes. Never fails the player: any
problem (no IMDb id, providers down) comes back as "no segments".
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.segments import SegmentsOut
from app.services import segment_service, tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["segments"])


@router.get("/segments", response_model=SegmentsOut)
async def get_segments(
    media_type: str,
    tmdb_id: int = Query(..., ge=1),
    season_number: int | None = Query(None, ge=0),
    episode_number: int | None = Query(None, ge=0),
    duration: float | None = Query(None, gt=0, le=86400, description="Length of the video file, seconds"),
    current_user: User = Depends(get_current_user),
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")
    if media_type == "tv" and (season_number is None or episode_number is None):
        raise HTTPException(status_code=422, detail="A TV episode needs season_number and episode_number.")

    try:
        imdb_id = (
            await tmdb_service.get_movie_imdb_id(tmdb_id)
            if media_type == "movie"
            else await tmdb_service.get_tv_imdb_id(tmdb_id)
        )
    except TMDBError:
        return SegmentsOut()
    if not imdb_id:
        return SegmentsOut()

    if media_type == "movie":
        season_number = episode_number = None
    return await segment_service.lookup(imdb_id, season_number, episode_number, duration)
