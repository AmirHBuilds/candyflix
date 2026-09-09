from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.schemas.media import Genre, MediaItem, MovieDetail, PagedMediaResponse
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(prefix="/movies", tags=["media"])


# IMPORTANT: all literal routes below must be declared before /{tmdb_id} —
# FastAPI matches routes in declaration order, and /{tmdb_id} would
# otherwise swallow them and fail trying to parse e.g. "popular" as an int.
@router.get("/popular", response_model=list[MediaItem])
async def popular_movies():
    try:
        return await tmdb_service.get_popular_movies()
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/popular/page", response_model=PagedMediaResponse)
async def popular_movies_page(page: int = Query(default=1, ge=1)):
    try:
        items, has_more = await tmdb_service.get_popular_movies_page(page)
        return PagedMediaResponse(items=items, has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/genres", response_model=list[Genre])
async def movie_genres():
    return tmdb_service.MOVIE_GENRES


@router.get("/discover", response_model=PagedMediaResponse)
async def discover_movies(
    page: int = Query(default=1, ge=1),
    genre: int | None = None,
    year: int | None = None,
    sort: Literal["popularity", "rating", "newest"] = "popularity",
    min_rating: float | None = Query(default=None, ge=0, le=10),
):
    try:
        items, has_more = await tmdb_service.discover_movies(
            page=page, genre=genre, year=year, sort=sort, min_rating=min_rating
        )
        return PagedMediaResponse(items=items, has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}", response_model=MovieDetail)
async def movie_detail(tmdb_id: int):
    try:
        return await tmdb_service.get_movie(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/similar", response_model=list[MediaItem])
async def similar_movies(tmdb_id: int):
    try:
        return await tmdb_service.get_similar_movies(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
