"""Spotting an account that is handed around: the same person signing in from many different addresses in a short time.

Every sign-in records its address (audit_service.record_sign_in). After each one this counts the account's different
addresses within the window; reaching the limit tells the admins once (not again for 12 hours). Phones change address
often, so the default limit (4 addresses in 24 hours) is on the generous side and the admin can change it."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_notice import AdminNotice
from app.models.audit import SignInLog
from app.models.user import User
from app.schemas.security import SharingIP, SharingOverview, SharingPerson
from app.schemas.site import SharingConfig
from app.services import geo_service, notice_service, telegram_service
from app.services.audit_service import device_label

COOLDOWN_HOURS = 12


async def _signins(db: AsyncSession, since: datetime, user_id: uuid.UUID | None = None):
    q = select(SignInLog).where(SignInLog.at >= since, SignInLog.ip.is_not(None))
    if user_id:
        q = q.where(SignInLog.user_id == user_id)
    return (await db.execute(q.order_by(SignInLog.at))).scalars().all()


def _ips(rows) -> list[SharingIP]:
    by: dict[str, list[SignInLog]] = {}
    for r in rows:
        by.setdefault(r.ip, []).append(r)
    out = [
        SharingIP(ip=ip, country=geo_service.country(ip), sign_ins=len(rs), first_at=rs[0].at, last_at=rs[-1].at, devices=sorted({device_label(r.user_agent) for r in rs}))
        for ip, rs in by.items()
    ]
    return sorted(out, key=lambda i: i.last_at, reverse=True)


async def check_after_sign_in(db: AsyncSession, user: User) -> bool:
    """True when this sign-in made the account look shared (and the admins were told)."""
    from app.services import site_service

    cfg = await site_service.get_sharing_config(db)
    if not cfg.enabled:
        return False
    now = datetime.now(timezone.utc)
    rows = await _signins(db, now - timedelta(hours=cfg.window_hours), user.id)
    ips = _ips(rows)
    if len(ips) < cfg.max_ips:
        return False
    recent = (
        await db.execute(
            select(AdminNotice.id).where(AdminNotice.kind == "sharing", AdminNotice.user_id == user.id, AdminNotice.at >= now - timedelta(hours=COOLDOWN_HOURS)).limit(1)
        )
    ).first()
    if recent:
        return False
    name = user.display_name
    hours = f"{cfg.window_hours} hours" if cfg.window_hours != 1 else "an hour"
    await notice_service.add(
        "sharing", f"{name} signed in from {len(ips)} different addresses",
        f"{len(ips)} different IP addresses in the last {hours}. Open Security to see them.", link="security", user_id=user.id, user_name=name,
    )
    telegram_service.report_sharing(name, len(ips), cfg.window_hours, [i.ip for i in ips][:8])
    return True


async def overview(db: AsyncSession, cfg: SharingConfig, hours: int | None = None) -> SharingOverview:
    window = hours or cfg.window_hours
    rows = await _signins(db, datetime.now(timezone.utc) - timedelta(hours=window))
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    per: dict[uuid.UUID, list[SignInLog]] = {}
    for r in rows:
        per.setdefault(r.user_id, []).append(r)
    people = []
    for uid, rs in per.items():
        u = users.get(uid)
        ips = _ips(rs)
        if u is None or len(ips) < 2:
            continue
        people.append(
            SharingPerson(
                user_id=uid, username=u.username, display_name=u.display_name, avatar_url=u.avatar_url, is_disabled=u.is_disabled,
                distinct_ips=len(ips), sign_ins=len(rs), flagged=len(ips) >= cfg.max_ips, ips=ips,
            )
        )
    people.sort(key=lambda p: (not p.flagged, -p.distinct_ips, p.display_name.lower()))
    return SharingOverview(window_hours=window, max_ips=cfg.max_ips, enabled=cfg.enabled, people=people)
