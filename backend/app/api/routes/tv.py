from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.schemas.media import Genre, MediaItem, PagedMediaResponse, SeasonDetail, TVShowDetail
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(prefix="/tv", tags=["media"])


# IMPORTANT: declared before /{tmdb_id} — see the note in movies.py.
@router.get("/popular", response_model=list[MediaItem])
async def popular_tv():
    try:
        return await tmdb_service.get_popular_tv()
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/popular/page", response_model=PagedMediaResponse)
async def popular_tv_page(page: int = Query(default=1, ge=1)):
    try:
        items, has_more = await tmdb_service.get_popular_tv_page(page)
        return PagedMediaResponse(items=items, has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/genres", response_model=list[Genre])
async def tv_genres():
    return tmdb_service.TV_GENRES


@router.get("/discover", response_model=PagedMediaResponse)
async def discover_tv(
    page: int = Query(default=1, ge=1),
    genre: int | None = None,
    year: int | None = None,
    sort: Literal["popularity", "rating", "newest"] = "popularity",
    min_rating: float | None = Query(default=None, ge=0, le=10),
):
    try:
        items, has_more = await tmdb_service.discover_tv(
            page=page, genre=genre, year=year, sort=sort, min_rating=min_rating
        )
        return PagedMediaResponse(items=items, has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}", response_model=TVShowDetail)
async def tv_detail(tmdb_id: int):
    try:
        return await tmdb_service.get_tv(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/similar", response_model=list[MediaItem])
async def similar_tv(tmdb_id: int):
    try:
        return await tmdb_service.get_similar_tv(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/season/{season_number}", response_model=SeasonDetail)
async def tv_season(tmdb_id: int, season_number: int):
    try:
        return await tmdb_service.get_season(tmdb_id, season_number)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
