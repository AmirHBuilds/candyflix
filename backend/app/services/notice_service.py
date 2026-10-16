"""Notices for the admins while they are on the site, and each admin's rest mode.

A notice is written once and shown to every admin; "read" and "resting" belong to each admin. Resting only silences
the pop-ups and the badge for that admin: the notices are still kept and listed. Telegram reports are separate."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AsyncSessionLocal
from app.models.admin_notice import AdminNotice, AdminPref
from app.models.user import User
from app.schemas.security import NoticeOut, NoticesOut

KEEP_DAYS = 30


async def add(kind: str, title: str, body: str | None = None, *, link: str | None = None, user_id: uuid.UUID | None = None, user_name: str | None = None) -> None:
    """Writes a notice with its own session. Never raises: a notice must not break what caused it."""
    try:
        async with AsyncSessionLocal() as db:
            db.add(AdminNotice(kind=kind, title=title[:200], body=(body or None) and body[:500], link=link, user_id=user_id, user_name=user_name))
            await db.commit()
    except Exception:
        pass


async def _pref(db: AsyncSession, admin: User) -> AdminPref:
    pref = await db.get(AdminPref, admin.id)
    if pref is None:
        pref = AdminPref(user_id=admin.id)
        db.add(pref)
        await db.flush()
    return pref


def _resting(pref: AdminPref, now: datetime) -> bool:
    return bool(pref.rest_forever or (pref.rest_until and pref.rest_until > now))


async def read(db: AsyncSession, admin: User, limit: int = 30) -> NoticesOut:
    now = datetime.now(timezone.utc)
    pref = await db.get(AdminPref, admin.id)
    since = pref.notices_read_at if pref else None
    rows = (await db.execute(select(AdminNotice).order_by(AdminNotice.at.desc()).limit(limit))).scalars().all()
    unread_q = select(func.count()).select_from(AdminNotice)
    if since:
        unread_q = unread_q.where(AdminNotice.at > since)
    unread = (await db.execute(unread_q)).scalar_one()
    resting = bool(pref and _resting(pref, now))
    return NoticesOut(
        items=[
            NoticeOut(id=n.id, at=n.at, kind=n.kind, title=n.title, body=n.body, link=n.link, user_id=n.user_id, user_name=n.user_name, unread=(since is None or n.at > since))
            for n in rows
        ],
        unread=int(unread),
        resting=resting,
        rest_until=pref.rest_until if pref and resting and not pref.rest_forever else None,
        rest_forever=bool(pref and pref.rest_forever),
        server_time=now,
    )


async def mark_read(db: AsyncSession, admin: User) -> None:
    pref = await _pref(db, admin)
    pref.notices_read_at = datetime.now(timezone.utc)
    await db.commit()


async def set_rest(db: AsyncSession, admin: User, minutes: int | None) -> None:
    """minutes: 0 = stop resting, a number = rest for that long, None = rest until turned off."""
    pref = await _pref(db, admin)
    now = datetime.now(timezone.utc)
    if minutes is None:
        pref.rest_forever, pref.rest_until = True, None
    elif minutes == 0:
        pref.rest_forever, pref.rest_until = False, None
    else:
        pref.rest_forever, pref.rest_until = False, now + timedelta(minutes=minutes)
    await db.commit()


async def cleanup() -> int:
    from sqlalchemy import delete

    async with AsyncSessionLocal() as db:
        res = await db.execute(delete(AdminNotice).where(AdminNotice.at < datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)))
        await db.commit()
        return res.rowcount or 0
