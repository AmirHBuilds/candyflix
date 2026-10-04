"""
/api/account — the signed-in person's own account.

Username is deliberately not editable here: only an admin can rename an
account (see routes/admin.py).
"""
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import SESSION_COOKIE_NAME
from app.models.user import User
from app.schemas.account import PasswordChange, ProfileUpdate
from app.schemas.auth import UserPublic
from app.services import account_service

router = APIRouter(prefix="/account", tags=["account"])


def _raise(exc: account_service.AccountError):
    raise HTTPException(status_code=exc.status, detail=exc.message)


@router.patch("/profile", response_model=UserPublic)
async def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await account_service.update_display_name(db, current_user, payload.display_name)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChange,
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await account_service.change_password(
            db, current_user, payload.current_password, payload.new_password, candyflix_session
        )
    except account_service.AccountError as exc:
        _raise(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/avatar", response_model=UserPublic)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Read at most one byte over the limit: enough to know it's too big,
    # without ever pulling a huge upload fully into memory.
    limit = get_settings().max_avatar_bytes
    data = await file.read(limit + 1)
    try:
        return await account_service.set_avatar(db, current_user, data)
    except account_service.AccountError as exc:
        _raise(exc)


@router.delete("/avatar", response_model=UserPublic)
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await account_service.clear_avatar(db, current_user)
