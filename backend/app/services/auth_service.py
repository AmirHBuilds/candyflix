"""
Auth service.

Owns:
- verifying credentials against the User table
- creating/reading/deleting server-side sessions in Redis

Sessions are intentionally simple: `session:<token>` -> user id string,
with a TTL. No refresh tokens, no rotation, no device tracking — this
is a small private app for a handful of trusted people.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.core.security import (
    SESSION_TTL_SECONDS,
    generate_session_token,
    hash_password,
    verify_password,
)
from app.models.user import User

SESSION_KEY_PREFIX = "session:"


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def list_users(db: AsyncSession) -> list[User]:
    """For the 'Who's watching?' profile-picker screen."""
    result = await db.execute(select(User).order_by(User.created_at))
    return list(result.scalars().all())


async def authenticate(db: AsyncSession, username: str, password: str) -> User | None:
    user = await get_user_by_username(db, username)
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def create_session(user_id: uuid.UUID) -> str:
    """Creates a new server-side session and returns its opaque token."""
    token = generate_session_token()
    redis = get_redis()
    await redis.set(f"{SESSION_KEY_PREFIX}{token}", str(user_id), ex=SESSION_TTL_SECONDS)
    return token


async def get_session_user_id(token: str) -> uuid.UUID | None:
    redis = get_redis()
    raw = await redis.get(f"{SESSION_KEY_PREFIX}{token}")
    if raw is None:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


async def delete_session(token: str) -> None:
    redis = get_redis()
    await redis.delete(f"{SESSION_KEY_PREFIX}{token}")


async def create_user(
    db: AsyncSession, username: str, display_name: str, password: str
) -> User:
    """Used only by the seed script — there is no public signup."""
    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
