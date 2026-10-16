"""
/api/account — the signed-in person's own account.

Username is deliberately not editable here: only an admin can rename an
account (see routes/admin.py).
"""
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import SESSION_COOKIE_NAME
from app.models.user import User
from app.schemas.account import PasswordChange, SessionOut, ProfileUpdate, TwoFactorLink, TwoFactorOff, TwoFactorStart, TwoFactorStatus
from app.schemas.auth import UserPublic
from app.core.security import verify_password
import uuid

from app.schemas.devices import DevicesOut
from app.services import account_service, audit_service, auth_service, device_service, site_service, telegram_service, two_factor_service

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


@router.get("/2fa", response_model=TwoFactorStatus)
async def two_factor_status(current_user: User = Depends(get_current_user)):
    return TwoFactorStatus(available=telegram_service.enabled(), enabled=current_user.two_factor_enabled)


@router.post("/2fa/start", response_model=TwoFactorLink)
async def two_factor_start(payload: TwoFactorStart, current_user: User = Depends(get_current_user)):
    """A link to the bot that connects this account's Telegram. Needs the password again."""
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Your password is incorrect.")
    try:
        return TwoFactorLink(url=await two_factor_service.start_link(current_user))
    except two_factor_service.TwoFactorError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)


@router.post("/2fa/off", status_code=status.HTTP_204_NO_CONTENT)
async def two_factor_off(payload: TwoFactorOff, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Your password is incorrect.")
    await two_factor_service.turn_off(db, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[SessionOut])
async def my_sessions(
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    current_user: User = Depends(get_current_user),
):
    """The devices signed in to this account (this one is marked)."""
    rows = await auth_service.list_sessions(current_user.id, candyflix_session)
    return [
        SessionOut(id=r["id"], at=r["at"], device=audit_service.device_label(r["user_agent"]), ip=r["ip"], current=r["current"])
        for r in rows
    ]


@router.post("/sessions/sign-out-others")
async def sign_out_other_devices(
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    current_user: User = Depends(get_current_user),
):
    return {"ended": await auth_service.invalidate_user_sessions(current_user.id, keep_token=candyflix_session)}


@router.delete("/sessions/{ref}", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_device(
    ref: str,
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    current_user: User = Depends(get_current_user),
):
    if candyflix_session and auth_service.session_ref(candyflix_session) == ref:
        raise HTTPException(status_code=400, detail="That's this device. Use Sign out instead.")
    if not await auth_service.revoke_session(current_user.id, ref):
        raise HTTPException(status_code=404, detail="That device is already signed out.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/devices", response_model=DevicesOut)
async def my_devices(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every device that has signed in to this account, with where it last was and when it was last seen."""
    cfg = await site_service.get_device_config(db)
    return await device_service.overview(db, current_user.id, cfg, request.cookies.get(device_service.COOKIE))


@router.delete("/devices/{device_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_my_device(
    device_uuid: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    mine = request.cookies.get(device_service.COOKIE)
    found = await device_service.find(db, current_user.id, mine)
    if found is not None and found.id == device_uuid:
        raise HTTPException(status_code=400, detail="That's this device. Use Sign out instead.")
    device, _ended = await device_service.end(db, current_user.id, device_uuid)
    if device is None:
        raise HTTPException(status_code=404, detail="That device isn't on your account.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
