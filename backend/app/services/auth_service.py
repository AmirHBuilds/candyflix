"""
Auth service.

Owns:
- verifying credentials against the User table
- creating/reading/deleting server-side sessions in Redis

Sessions are intentionally simple: `session:<token>` -> user id string,
with a TTL. No refresh tokens, no rotation, no device tracking — this
is a small private app for a handful of trusted people.

One addition: `user_sessions:<user id>` is a set of that person's live
tokens. It exists so that "sign this person out everywhere" is possible —
needed when an admin resets a password or deletes an account, and when
someone changes their own password (other devices must stop working).
"""
import uuid
from datetime import datetime, timezone

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


async def record_login(db: AsyncSession, user: User, user_agent: str | None = None) -> None:
    """Stamps the login time (shown in the admin panel) and adds a line to the sign-in log."""
    from app.services import audit_service

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await audit_service.record_sign_in(db, user, user_agent)


USER_SESSIONS_PREFIX = "user_sessions:"


async def create_session(user_id: uuid.UUID) -> str:
    """Creates a new server-side session and returns its opaque token."""
    token = generate_session_token()
    redis = get_redis()
    await redis.set(f"{SESSION_KEY_PREFIX}{token}", str(user_id), ex=SESSION_TTL_SECONDS)
    index = f"{USER_SESSIONS_PREFIX}{user_id}"
    await redis.sadd(index, token)
    await redis.expire(index, SESSION_TTL_SECONDS)
    return token


async def invalidate_user_sessions(user_id: uuid.UUID, keep_token: str | None = None) -> int:
    """Signs a person out everywhere (optionally sparing one session,
    e.g. the device they just changed their password on). Returns how
    many sessions were ended."""
    redis = get_redis()
    index = f"{USER_SESSIONS_PREFIX}{user_id}"
    tokens = [t for t in await redis.smembers(index) if t != keep_token]
    for token in tokens:
        await redis.delete(f"{SESSION_KEY_PREFIX}{token}")
        await redis.srem(index, token)
    return len(tokens)


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
    raw = await redis.get(f"{SESSION_KEY_PREFIX}{token}")
    await redis.delete(f"{SESSION_KEY_PREFIX}{token}")
    if raw is not None:
        await redis.srem(f"{USER_SESSIONS_PREFIX}{raw}", token)


async def create_user(
    db: AsyncSession, username: str, display_name: str, password: str, is_admin: bool = False
) -> User:
    """Used by the CLI and the admin panel — there is no public signup."""
    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        is_admin=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
