"""/api/opinions — what people think of titles, replies and likes. See services/opinions_service.py."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas import opinions as s
from app.services import opinions_service as svc

router = APIRouter(prefix="/opinions", tags=["opinions"])


@router.get("/feed", response_model=s.Feed)
async def feed(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await svc.feed(db, user)


@router.get("/title", response_model=s.TitleOpinions)
async def title_opinions(
    media_type: Literal["movie", "tv"],
    tmdb_id: int = Query(gt=0),
    season_number: int = Query(default=-1, ge=-1, le=1000),
    episode_number: int = Query(default=-1, ge=-1, le=10000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = s.Scope(media_type=media_type, tmdb_id=tmdb_id, season_number=season_number, episode_number=episode_number)
    return await svc.for_title(db, user, scope)


@router.post("", response_model=s.OpinionOut, status_code=status.HTTP_201_CREATED)
async def create(body: s.OpinionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await svc.post(db, user, body)


@router.delete("/{opinion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(opinion_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await svc.delete_opinion(db, user, opinion_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{opinion_id}/like", response_model=s.OpinionLikeResult)
async def like_opinion(opinion_id: uuid.UUID, liked: bool = True, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await svc.set_opinion_like(db, user, opinion_id, liked)


@router.put("/likes/title", response_model=s.LikeResult)
async def like_title(body: s.LikeSet, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return s.LikeResult(likes=await svc.set_title_like(db, user, body))
