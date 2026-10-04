"""A person's own account: display name, password, profile picture."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.services import auth_service, avatar_service


class AccountError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


async def update_display_name(db: AsyncSession, user: User, display_name: str) -> User:
    user.display_name = display_name
    await db.commit()
    await db.refresh(user)
    return user


async def change_password(
    db: AsyncSession, user: User, current: str, new: str, keep_token: str | None
) -> None:
    if not verify_password(current, user.password_hash):
        raise AccountError("Your current password is incorrect.")
    if current == new:
        raise AccountError("Your new password must be different from the current one.")
    user.password_hash = hash_password(new)
    await db.commit()
    # Anyone else holding this account (a lost phone, a shared computer)
    # is signed out; the device that just changed it stays signed in.
    await auth_service.invalidate_user_sessions(user.id, keep_token=keep_token)


async def set_avatar(db: AsyncSession, user: User, data: bytes) -> User:
    try:
        webp = avatar_service.process_upload(data)
    except avatar_service.AvatarError as exc:
        raise AccountError(exc.message, exc.status) from exc
    previous = user.avatar_path
    user.avatar_path = avatar_service.store(user.id, webp)
    await db.commit()
    avatar_service.remove(previous)
    await db.refresh(user)
    return user


async def clear_avatar(db: AsyncSession, user: User) -> User:
    previous = user.avatar_path
    user.avatar_path = None
    await db.commit()
    avatar_service.remove(previous)
    await db.refresh(user)
    return user
