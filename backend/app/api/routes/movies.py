from fastapi import APIRouter, HTTPException

from app.schemas.media import MovieDetail
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(prefix="/movies", tags=["media"])


@router.get("/{tmdb_id}", response_model=MovieDetail)
async def movie_detail(tmdb_id: int):
    try:
        return await tmdb_service.get_movie(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
