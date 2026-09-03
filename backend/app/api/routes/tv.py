from fastapi import APIRouter, HTTPException

from app.schemas.media import SeasonDetail, TVShowDetail
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(prefix="/tv", tags=["media"])


@router.get("/{tmdb_id}", response_model=TVShowDetail)
async def tv_detail(tmdb_id: int):
    try:
        return await tmdb_service.get_tv(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/season/{season_number}", response_model=SeasonDetail)
async def tv_season(tmdb_id: int, season_number: int):
    try:
        return await tmdb_service.get_season(tmdb_id, season_number)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
