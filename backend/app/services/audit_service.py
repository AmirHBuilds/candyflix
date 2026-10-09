"""
Audit trail: what admins do (including looking at someone's history) and
every sign-in, so the "admin sees everything" power is itself visible.

Looking at a page is logged once per admin, person and kind within a short
window, so a screen that is open for an hour is one line, not hundreds.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog, SignInLog
from app.models.user import User
from app.schemas import admin as schemas
from app.services import telegram_service

VIEW_DEDUPE = timedelta(minutes=10)


async def record(
    db: AsyncSession,
    actor: User,
    action: str,
    *,
    target: User | None = None,
    target_name: str | None = None,
    detail: str | None = None,
    dedupe: timedelta | None = None,
) -> None:
    # Earlier commits in the same request expire loaded objects; reload them
    # here so reading their names can't trigger a lazy load.
    await db.refresh(actor)
    if target is not None:
        await db.refresh(target)
    actor_id, actor_name = actor.id, actor.display_name
    target_id = target.id if target is not None else None
    name = target.display_name if target is not None else target_name
    if dedupe is not None:
        query = select(func.count()).where(
            AuditLog.actor_id == actor_id,
            AuditLog.action == action,
            AuditLog.at >= datetime.now(timezone.utc) - dedupe,
        )
        query = query.where(AuditLog.target_user_id == target_id)
        if await db.scalar(query):
            return
    if dedupe is None:  # merely looking at a page is not reported
        telegram_service.report_admin_action(actor_name, action, name, detail)
    db.add(
        AuditLog(
            actor_id=actor_id,
            actor_name=actor_name,
            action=action,
            target_user_id=target_id,
            target_name=(name or None) and name[:200],
            detail=(detail or None) and detail[:300],
        )
    )
    await db.commit()


async def list_audit(db: AsyncSession, limit: int, offset: int) -> schemas.AuditPage:
    total = await db.scalar(select(func.count()).select_from(AuditLog)) or 0
    rows = (
        await db.execute(select(AuditLog).order_by(AuditLog.at.desc(), AuditLog.id).limit(limit).offset(offset))
    ).scalars().all()
    return schemas.AuditPage(
        items=[
            schemas.AuditEntry(
                id=r.id,
                at=r.at,
                actor_id=r.actor_id,
                actor_name=r.actor_name,
                action=r.action,
                target_user_id=r.target_user_id,
                target_name=r.target_name,
                detail=r.detail,
            )
            for r in rows
        ],
        total=int(total),
    )


# ---------- sign-ins ----------


async def record_sign_in(db: AsyncSession, user: User, user_agent: str | None) -> None:
    name, uid = user.display_name, user.id
    db.add(SignInLog(user_id=uid, user_agent=(user_agent or None) and user_agent[:300]))
    await db.commit()
    telegram_service.report_sign_in(name, device_label(user_agent))


def device_label(user_agent: str | None) -> str:
    """'Chrome on Windows' from a User-Agent string; deliberately coarse."""
    if not user_agent:
        return "Unknown device"
    ua = user_agent
    if re.search(r"iPhone|iPad|iPod", ua):
        os_name = "iOS"
    elif "Android" in ua:
        os_name = "Android"
    elif "Windows" in ua:
        os_name = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "CrOS" in ua:
        os_name = "ChromeOS"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = None
    if re.search(r"Edg(e|A|iOS)?/", ua):
        browser = "Edge"
    elif re.search(r"OPR/|Opera", ua):
        browser = "Opera"
    elif re.search(r"Firefox/|FxiOS/", ua):
        browser = "Firefox"
    elif re.search(r"Chrome/|CriOS/", ua):
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = None
    if browser and os_name:
        return f"{browser} on {os_name}"
    return browser or os_name or "Unknown device"


async def list_sign_ins(db: AsyncSession, limit: int, offset: int, user_id: uuid.UUID | None = None) -> schemas.SignInPage:
    where = [SignInLog.user_id == user_id] if user_id else []
    total = await db.scalar(select(func.count()).select_from(SignInLog).where(*where)) or 0
    rows = (
        await db.execute(
            select(SignInLog, User)
            .join(User, User.id == SignInLog.user_id)
            .where(*where)
            .order_by(SignInLog.at.desc(), SignInLog.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return schemas.SignInPage(
        items=[
            schemas.SignInEntry(
                id=s.id,
                at=s.at,
                user_id=u.id,
                username=u.username,
                display_name=u.display_name,
                avatar_url=u.avatar_url,
                device=device_label(s.user_agent),
            )
            for s, u in rows
        ],
        total=int(total),
    )
