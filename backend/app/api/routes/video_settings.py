"""
/api/video-settings — the signed-in person's per-video player tweaks.

The video is identified by query parameters (not path segments), the same
way /watch-progress/tv/{id}/season-progress does it, so no route can be
shadowed by another with the same path shape.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.video_settings import ClearedResult, VideoSettingsPatch
from app.services import video_settings_service as service

router = APIRouter(prefix="/video-settings", tags=["video-settings"])


class VideoRef:
    def __init__(
        self,
        media_type: Literal["movie", "tv"] = Query(...),
        tmdb_id: int = Query(..., ge=1),
        season_number: int | None = Query(None, ge=0),
        episode_number: int | None = Query(None, ge=0),
    ):
        if media_type == "tv" and (season_number is None or episode_number is None):
            raise HTTPException(status_code=422, detail="A TV episode needs season_number and episode_number.")
        if media_type == "movie":
            season_number = episode_number = None
        self.media_type, self.tmdb_id = media_type, tmdb_id
        self.season_number, self.episode_number = season_number, episode_number


@router.get("")
async def get_video_settings(
    ref: VideoRef = Depends(), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    return await service.get(db, user.id, ref.tmdb_id, ref.media_type, ref.season_number, ref.episode_number)


@router.patch("")
async def patch_video_settings(
    changes: VideoSettingsPatch,
    ref: VideoRef = Depends(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await service.patch(db, user.id, ref.tmdb_id, ref.media_type, ref.season_number, ref.episode_number, changes)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video_settings(
    ref: VideoRef = Depends(), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await service.delete_one(db, user.id, ref.tmdb_id, ref.media_type, ref.season_number, ref.episode_number)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/all", response_model=ClearedResult)
async def delete_all_video_settings(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return ClearedResult(cleared=await service.delete_all(db, user.id))
