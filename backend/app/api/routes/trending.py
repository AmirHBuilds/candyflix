from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user
from app.models.user import User
from app.services import content_rating_service

from app.schemas.media import MediaItem
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["media"])


@router.get("/trending", response_model=list[MediaItem])
async def trending(window: Literal["day", "week"] = Query(default="day"), user: User = Depends(get_current_user)):
    try:
        return await content_rating_service.filter_items(user, await tmdb_service.get_trending(window=window))
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
