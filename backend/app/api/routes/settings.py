"""
/api/settings — the signed-in person's own settings.

GET returns the full resolved document (defaults filled in). PATCH
changes some of it (see settings_service for the merge rules). DELETE
resets everything to defaults. Everything is scoped to the current user;
there is deliberately no way to read or write someone else's settings.
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.settings import UserSettings
from app.schemas.video_settings import STYLE_KEYS
from app.services import settings_service, video_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettings)
async def get_my_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await settings_service.get_settings(db, current_user.id)


@router.patch("", response_model=UserSettings)
async def patch_my_settings(
    patch: dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await settings_service.patch_settings(db, current_user.id, patch)
    except settings_service.SettingsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.problems
        )
    # A new global subtitle default replaces any per-video value for that same
    # key (timing offset and language are per-video only and never touched).
    sent = patch.get("subtitles")
    if isinstance(sent, dict):
        keys = {f"subtitle_{k}" for k in sent if k in STYLE_KEYS}
        await video_settings_service.clear_keys(db, current_user.id, keys)
    return result


@router.delete("", response_model=UserSettings)
async def reset_my_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await settings_service.reset_settings(db, current_user.id)
