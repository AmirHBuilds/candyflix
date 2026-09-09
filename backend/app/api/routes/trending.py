from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.schemas.media import MediaItem
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["media"])


@router.get("/trending", response_model=list[MediaItem])
async def trending(window: Literal["day", "week"] = Query(default="day")):
    try:
        return await tmdb_service.get_trending(window=window)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
