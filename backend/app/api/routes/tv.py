from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.media import Genre, MediaItem, SeasonDetail, TVShowDetail, PagedMediaResponse
from app.services import content_rating_service, tmdb_service
from app.services.tmdb_service import TMDBError

router = APIRouter(prefix="/tv", tags=["media"])
KIND = "tv"


# IMPORTANT: all literal routes below must be declared before /{tmdb_id} —
# FastAPI matches routes in declaration order, and /{tmdb_id} would
# otherwise swallow them and fail trying to parse e.g. "popular" as an int.
# Everything here needs a signed-in person, because what they may see depends on their age limit
# (content_rating_service); lists are filtered and single titles refuse with 403.
@router.get("/popular", response_model=list[MediaItem])
async def popular(user: User = Depends(get_current_user)):
    try:
        return await content_rating_service.filter_items(user, await tmdb_service.get_popular_tv())
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/popular/page", response_model=PagedMediaResponse)
async def popular_page(page: int = Query(default=1, ge=1), user: User = Depends(get_current_user)):
    try:
        items, has_more = await tmdb_service.get_popular_tv_page(page)
        return PagedMediaResponse(items=await content_rating_service.filter_items(user, items), has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/genres", response_model=list[Genre])
async def genres(_: User = Depends(get_current_user)):
    return tmdb_service.TV_GENRES


@router.get("/discover", response_model=PagedMediaResponse)
async def discover(
    page: int = Query(default=1, ge=1),
    genre: int | None = None,
    year: int | None = None,
    sort: Literal["popularity", "rating", "newest"] = "popularity",
    min_rating: float | None = Query(default=None, ge=0, le=10),
    user: User = Depends(get_current_user),
):
    try:
        items, has_more = await tmdb_service.discover_tv(
            page=page, genre=genre, year=year, sort=sort, min_rating=min_rating
        )
        return PagedMediaResponse(items=await content_rating_service.filter_items(user, items), has_more=has_more)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}", response_model=TVShowDetail)
async def detail(tmdb_id: int, user: User = Depends(get_current_user)):
    await content_rating_service.ensure(user, KIND, tmdb_id)
    try:
        return await tmdb_service.get_tv(tmdb_id)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/similar", response_model=list[MediaItem])
async def similar(tmdb_id: int, user: User = Depends(get_current_user)):
    await content_rating_service.ensure(user, KIND, tmdb_id)
    try:
        return await content_rating_service.filter_items(user, await tmdb_service.get_similar_tv(tmdb_id))
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{tmdb_id}/season/{season_number}", response_model=SeasonDetail)
async def tv_season(tmdb_id: int, season_number: int, user: User = Depends(get_current_user)):
    await content_rating_service.ensure(user, KIND, tmdb_id)
    try:
        return await tmdb_service.get_season(tmdb_id, season_number)
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
