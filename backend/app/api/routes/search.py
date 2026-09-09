from fastapi import APIRouter, HTTPException, Query

from app.schemas.media import MediaItem
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["media"])


@router.get("/search", response_model=list[MediaItem])
async def search(q: str = Query(..., min_length=1)):
    try:
        return await tmdb_service.search(q)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
