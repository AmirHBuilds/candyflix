from fastapi import APIRouter, HTTPException

from app.schemas.media import MediaItem
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["media"])


@router.get("/trending", response_model=list[MediaItem])
async def trending():
    try:
        return await tmdb_service.get_trending()
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
