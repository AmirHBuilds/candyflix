"""
Authentication routes.

No signup, no OAuth, no email verification, no password reset, no 2FA.
Users are provisioned only via the seed script (see app/cli.py). This
is a small, private, invite-only app.
"""
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.core.security import SESSION_COOKIE_NAME, session_cookie_kwargs
from app.models.user import User
from app.schemas.auth import LoginRequest, UserPublic
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/users", response_model=list[UserPublic])
async def list_users(db: AsyncSession = Depends(get_db)):
    """
    Powers the 'Who's watching?' screen — a public list of profile
    names/usernames (no password data) so the person can pick
    themselves without typing a username.
    """
    return await auth_service.list_users(db)


@router.post("/login", response_model=UserPublic)
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    user = await auth_service.authenticate(db, payload.username, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    token = await auth_service.create_session(user.id)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=60 * 60 * 24 * 30,
        **session_cookie_kwargs(),
    )
    return user


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
