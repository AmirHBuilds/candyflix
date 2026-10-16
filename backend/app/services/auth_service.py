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
import hashlib
import json
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


async def record_login(db: AsyncSession, user: User, user_agent: str | None = None, ip: str | None = None) -> None:
    """Stamps the login time (shown in the admin panel) and adds a line to the sign-in log."""
    from app.services import audit_service

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await audit_service.record_sign_in(db, user, user_agent, ip)


USER_SESSIONS_PREFIX = "user_sessions:"


SESSION_META_PREFIX = "session_meta:"


def session_ref(token: str) -> str:
    """A short public name for a session, so the list of devices never has to show the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def create_session(user_id: uuid.UUID, user_agent: str | None = None, ip: str | None = None, device: str | None = None) -> str:
    """Creates a new server-side session and returns its opaque token."""
    token = generate_session_token()
    redis = get_redis()
    await redis.set(f"{SESSION_KEY_PREFIX}{token}", str(user_id), ex=SESSION_TTL_SECONDS)
    await redis.set(
        f"{SESSION_META_PREFIX}{token}",
        json.dumps({"at": datetime.now(timezone.utc).isoformat(), "ua": (user_agent or "")[:300], "ip": (ip or "")[:45], "device": device or ""}),
        ex=SESSION_TTL_SECONDS,
    )
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
        await redis.delete(f"{SESSION_KEY_PREFIX}{token}", f"{SESSION_META_PREFIX}{token}")
        await redis.srem(index, token)
    return len(tokens)


async def list_sessions(user_id: uuid.UUID, current_token: str | None = None) -> list[dict]:
    """The devices signed in as this person, newest first. Sessions that already expired are dropped from the index."""
    redis = get_redis()
    index = f"{USER_SESSIONS_PREFIX}{user_id}"
    out: list[dict] = []
    for token in await redis.smembers(index):
        if not await redis.exists(f"{SESSION_KEY_PREFIX}{token}"):
            await redis.srem(index, token)
            continue
        try:
            meta = json.loads(await redis.get(f"{SESSION_META_PREFIX}{token}") or "{}")
        except ValueError:
            meta = {}
        out.append(
            {
                "id": session_ref(token),
                "at": meta.get("at"),
                "user_agent": meta.get("ua") or None,
                "ip": meta.get("ip") or None,
                "device": meta.get("device") or None,
                "current": token == current_token,
            }
        )
    return sorted(out, key=lambda x: x["at"] or "", reverse=True)


async def session_meta(token: str) -> dict:
    try:
        return json.loads(await get_redis().get(f"{SESSION_META_PREFIX}{token}") or "{}")
    except ValueError:
        return {}


async def set_session_device(token: str, device_id: str) -> None:
    """Links an existing session to a device (sessions made before devices were tracked get one when seen)."""
    meta = await session_meta(token)
    meta["device"] = device_id
    await get_redis().set(f"{SESSION_META_PREFIX}{token}", json.dumps(meta), keepttl=True)


async def revoke_device_sessions(user_id: uuid.UUID, device_id: str, keep_token: str | None = None) -> int:
    """Ends every session that belongs to one device. Returns how many."""
    redis = get_redis()
    index = f"{USER_SESSIONS_PREFIX}{user_id}"
    ended = 0
    for token in await redis.smembers(index):
        if token == keep_token:
            continue
        if (await session_meta(token)).get("device") == device_id:
            await redis.delete(f"{SESSION_KEY_PREFIX}{token}", f"{SESSION_META_PREFIX}{token}")
            await redis.srem(index, token)
            ended += 1
    return ended


async def revoke_session(user_id: uuid.UUID, ref: str) -> bool:
    """Ends one of this person's sessions by its public name. False if there is no such session."""
    redis = get_redis()
    index = f"{USER_SESSIONS_PREFIX}{user_id}"
    for token in await redis.smembers(index):
        if session_ref(token) == ref:
            await redis.delete(f"{SESSION_KEY_PREFIX}{token}", f"{SESSION_META_PREFIX}{token}")
            await redis.srem(index, token)
            return True
    return False


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
    await redis.delete(f"{SESSION_KEY_PREFIX}{token}", f"{SESSION_META_PREFIX}{token}")
    if raw is not None:
        await redis.srem(f"{USER_SESSIONS_PREFIX}{raw}", token)


async def create_user(
    db: AsyncSession, username: str, display_name: str, password: str, is_admin: bool = False, age_limit: str | None = None
) -> User:
    """Used by the CLI and the admin panel — there is no public signup."""
    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        is_admin=is_admin,
        age_limit=age_limit,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
