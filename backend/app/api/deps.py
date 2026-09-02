"""
Shared FastAPI dependencies.
"""
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import SESSION_COOKIE_NAME
from app.models.user import User
from app.services import auth_service


async def get_current_user(
    candyflix_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Resolves the current user from the session cookie.

    Raises 401 if there's no session cookie, the session has expired,
    or (edge case) the session points at a user that no longer exists.
    Use this as a dependency on any route that should require login.
    """
    if candyflix_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = await auth_service.get_session_user_id(candyflix_session)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = await auth_service.get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user
