"""Ratings route (Phase 12): IMDb / Rotten Tomatoes / Metacritic for one title."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.ratings import RatingsOut
from app.services import ratings_service

router = APIRouter(tags=["ratings"])


@router.get("/ratings/{media_type}/{tmdb_id}", response_model=RatingsOut)
async def title_ratings(media_type: str, tmdb_id: int, current_user: User = Depends(get_current_user)):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")
    return await ratings_service.get_ratings(media_type, tmdb_id)
