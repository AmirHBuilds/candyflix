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
from app.models.watch_progress import NO_EPISODE, NO_SEASON
from app.schemas.video_settings import ClearedResult, SubtitleOverride, VideoSettingsPatch
from app.services import tmdb_service
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


# --- Review list: videos that have their own subtitle settings ---

async def _title_for(media_type: str, tmdb_id: int) -> str | None:
    try:
        detail = await (tmdb_service.get_movie(tmdb_id) if media_type == "movie" else tmdb_service.get_tv(tmdb_id))
        return detail.title
    except Exception:  # a title we can't look up is still listed, by id
        return None


@router.get("/subtitles", response_model=list[SubtitleOverride])
async def list_subtitle_overrides(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await service.list_subtitle_overrides(db, user.id)
    titles: dict[tuple[str, int], str | None] = {}
    out = []
    for row, sub in rows:
        key = (row.media_type, row.tmdb_id)
        if key not in titles:
            titles[key] = await _title_for(*key)
        out.append(
            SubtitleOverride(
                media_type=row.media_type,
                tmdb_id=row.tmdb_id,
                season_number=None if row.season_number == NO_SEASON else row.season_number,
                episode_number=None if row.episode_number == NO_EPISODE else row.episode_number,
                title=titles[key],
                settings=sub,
                updated_at=row.updated_at.isoformat() if row.updated_at else None,
            )
        )
    return out


@router.delete("/subtitles/all", response_model=ClearedResult)
async def clear_all_subtitle_overrides(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return ClearedResult(cleared=await service.clear_subtitle_all(db, user.id))


@router.delete("/subtitles", status_code=status.HTTP_204_NO_CONTENT)
async def clear_subtitle_override(
    ref: VideoRef = Depends(), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await service.clear_subtitle_one(db, user.id, ref.tmdb_id, ref.media_type, ref.season_number, ref.episode_number)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
