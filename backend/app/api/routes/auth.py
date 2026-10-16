"""
Authentication routes.

No public signup, no OAuth, no email verification. People are created by
an admin (or the CLI in app/cli.py) — this is a small, private,
invite-only app.
"""
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.core.security import SESSION_COOKIE_NAME, session_cookie_kwargs
from app.models.user import User
from app.schemas.auth import LoginRequest, ProfileEntry, TwoFactorChallenge, TwoFactorResend, TwoFactorVerify, UserPublic
from app.services import auth_service, login_guard_service, site_service, telegram_service, two_factor_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/users", response_model=list[ProfileEntry])
async def list_users(db: AsyncSession = Depends(get_db)):
    """
    Powers the 'Who's watching?' screen — a public list of profile
    names/usernames (no password data) so the person can pick
    themselves without typing a username.
    """
    return await auth_service.list_users(db)


@router.post("/login", response_model=UserPublic | TwoFactorChallenge)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else None
    cfg = await site_service.get_login_guard_config(db)
    if cfg.enabled:
        block = await login_guard_service.check(payload.username, ip)
        # Same answer whether or not the password would have been right. The one way through: a name block doesn't
        # stop an address that person has already signed in from, so a stranger can't keep them out of their own home.
        if block is not None and not (block.scope == "name" and await login_guard_service.is_known_address(db, payload.username, ip)):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=login_guard_service.message_for(block.seconds_left),
                headers={"Retry-After": str(block.seconds_left)},
            )

    user = await auth_service.authenticate(db, payload.username, payload.password)
    if user is None:
        telegram_service.report_failed_sign_in(payload.username, ip, "wrong name or password")
        await login_guard_service.failed(payload.username, ip, "wrong name or password", cfg)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    # Only said after the password was right, so guessing can't be used
    # to discover which accounts exist or are switched off.
    if user.is_disabled:
        telegram_service.report_failed_sign_in(payload.username, ip, "account is switched off")
        await login_guard_service.add_event("failed", payload.username, ip, "account is switched off")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled. Please ask an admin.",
        )

    await login_guard_service.record_success(payload.username)

    if user.telegram_chat_id is not None:
        # Right password, but two-step sign-in is on: send a code and wait for it.
        try:
            challenge = await two_factor_service.begin_login(user)
        except two_factor_service.TwoFactorError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message)
        return TwoFactorChallenge(challenge=challenge)

    await _finish_login(db, user, request, response)
    return UserPublic.model_validate(user)


async def _finish_login(db: AsyncSession, user: User, request: Request, response: Response) -> None:
    await auth_service.record_login(db, user, request.headers.get("user-agent"), request.client.host if request.client else None)
    token = await auth_service.create_session(user.id, request.headers.get("user-agent"), request.client.host if request.client else None)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=60 * 60 * 24 * 30,
        **session_cookie_kwargs(),
    )


@router.post("/login/verify", response_model=UserPublic)
async def login_verify(
    payload: TwoFactorVerify,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await two_factor_service.verify(db, payload.challenge, payload.code)
    except two_factor_service.TwoFactorError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    await _finish_login(db, user, request, response)
    return UserPublic.model_validate(user)


@router.post("/login/resend", status_code=status.HTTP_204_NO_CONTENT)
async def login_resend(payload: TwoFactorResend, db: AsyncSession = Depends(get_db)):
    try:
        await two_factor_service.resend(db, payload.challenge)
    except two_factor_service.TwoFactorError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout")
async def logout(
    response: Response,
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    # Logout always succeeds and always clears the browser cookie, even
    # if the session had already expired server-side. We only attempt
    # to delete the server-side session if a cookie was actually sent.
    if candyflix_session is not None:
        await auth_service.delete_session(candyflix_session)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
