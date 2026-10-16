"""Devices: which browsers and phones a person signs in from, and the limits on them.

A device is a random id kept in a long-lived cookie (`candyflix_device`), set at sign-in. The same browser stays one device
when its address changes or it signs in again; clearing cookies makes a new one. Each device keeps its history (addresses,
country, first and last seen) after the sign-in ends. Sessions in Redis point to their device, so a device can be signed out.

Limits (DeviceConfig): different devices signing in per 24 hours, and devices signed in at once. At the limit the admins are
told; depending on the setting the sign-in is also refused, or the oldest device is signed out. Admins are never refused."""
import asyncio
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AsyncSessionLocal
from app.core.redis import get_redis
from app.models.admin_notice import AdminNotice
from app.models.device import Device
from app.models.user import User
from app.schemas.devices import DeviceOut, DevicesOut
from app.schemas.site import DeviceConfig
from app.services import auth_service, geo_service, notice_service, telegram_service
from app.services.audit_service import device_label

COOKIE = "candyflix_device"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365
SEEN_EVERY_SECONDS = 300
KEEP_DAYS = 90
COOLDOWN_HOURS = 12

_tasks: set[asyncio.Task] = set()


def new_device_id() -> str:
    return secrets.token_urlsafe(24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def find(db: AsyncSession, user_id: uuid.UUID, device_id: str | None) -> Device | None:
    if not device_id:
        return None
    return (await db.execute(select(Device).where(Device.user_id == user_id, Device.device_id == device_id))).scalar_one_or_none()


async def register(db: AsyncSession, user: User, device_id: str, user_agent: str | None, ip: str | None) -> tuple[Device, int, bool]:
    """Records a sign-in from this device. Returns the device, how many OTHER devices the person had before, and whether this one is new."""
    uid = user.id
    prior = int(await db.scalar(select(func.count()).select_from(Device).where(Device.user_id == uid, Device.device_id != device_id)) or 0)
    now = _now()
    device = await find(db, uid, device_id)
    code = geo_service.country(ip)
    created = device is None
    if device is None:
        device = Device(
            user_id=uid, device_id=device_id, label=device_label(user_agent), user_agent=(user_agent or None) and user_agent[:300],
            first_ip=ip, last_ip=ip, country=code, first_seen=now, last_seen=now, last_login_at=now, sign_ins=1,
        )
        db.add(device)
    else:
        device.label = device_label(user_agent)
        device.user_agent = (user_agent or None) and user_agent[:300]
        device.last_ip, device.country = ip, code
        device.last_seen = device.last_login_at = now
        device.sign_ins += 1
    await db.commit()
    await db.refresh(device)
    return device, prior, created


@dataclass
class Verdict:
    over_day: bool = False
    over_active: bool = False
    today: int = 0  # different devices that signed in within 24 hours (not counting this one unless already counted)
    active_others: int = 0  # live devices other than this one

    @property
    def over(self) -> bool:
        return self.over_day or self.over_active


async def _live_devices(user_id: uuid.UUID) -> dict[str, list[dict]]:
    by: dict[str, list[dict]] = {}
    for s in await auth_service.list_sessions(user_id):
        by.setdefault(s.get("device") or f"session:{s['id']}", []).append(s)
    return by


async def evaluate(db: AsyncSession, user: User, device_id: str, cfg: DeviceConfig) -> Verdict:
    since = _now() - timedelta(hours=24)
    rows = (await db.execute(select(Device.device_id).where(Device.user_id == user.id, Device.last_login_at >= since))).scalars().all()
    counted = device_id in rows
    live = await _live_devices(user.id)
    others = [d for d in live if d != device_id]
    return Verdict(
        over_day=(not counted) and len(rows) + 1 > cfg.max_devices_per_day,
        over_active=len(others) + 1 > cfg.max_active,
        today=len(rows),
        active_others=len(others),
    )


async def make_room(user_id: uuid.UUID, device_id: str, cfg: DeviceConfig) -> int:
    """Signs out the devices that have been signed in longest until this one fits. Returns how many were signed out."""
    live = await _live_devices(user_id)
    others = sorted((d for d in live if d != device_id), key=lambda d: min(s["at"] or "" for s in live[d]))
    ended = 0
    while len(others) + 1 > cfg.max_active and others:
        victim = others.pop(0)
        for s in live[victim]:
            await auth_service.revoke_session(user_id, s["id"])
        ended += 1
    return ended


def _why(v: Verdict, cfg: DeviceConfig) -> str:
    parts = []
    if v.over_day:
        parts.append(f"more than {cfg.max_devices_per_day} different devices in 24 hours")
    if v.over_active:
        parts.append(f"more than {cfg.max_active} devices signed in at once")
    return " and ".join(parts)


def refusal_message(v: Verdict) -> str:
    if v.over_active and not v.over_day:
        return "This account is signed in on too many devices. Sign out of one in Settings > Your devices, or ask an admin."
    return "This account has been used on too many different devices today. Please try again tomorrow, or ask an admin."


async def alert_limit(db: AsyncSession, user: User, v: Verdict, cfg: DeviceConfig, label: str, ip: str | None, refused: bool) -> None:
    """Tells the admins (bell + Telegram) once per 12 hours per person."""
    now = _now()
    name, uid = user.display_name, user.id
    recent = (
        await db.execute(select(AdminNotice.id).where(AdminNotice.kind == "devices", AdminNotice.user_id == uid, AdminNotice.at >= now - timedelta(hours=COOLDOWN_HOURS)).limit(1))
    ).first()
    if recent:
        return
    why = _why(v, cfg)
    country = geo_service.country(ip)
    await notice_service.add(
        "devices", f"{name} {'was refused' if refused else 'went over the device limit'}",
        f"{label} from {ip or 'unknown'}{f' ({country})' if country and country != 'LAN' else ''}: {why}.", link="security", user_id=uid, user_name=name,
    )
    telegram_service.report_device_limit(name, why, refused, label, ip, country)


def tell_user_about_new_device(user: User, label: str, ip: str | None) -> None:
    """A Telegram message to the person (only if they linked Telegram). Sent in the background so sign-in never waits for it."""
    chat = user.telegram_chat_id
    if chat is None:
        return
    country = geo_service.country(ip)
    place = f" in {country}" if country and country != "LAN" else ""

    async def go():
        try:
            await telegram_service.send_to_chat(chat, f"🔔 <b>New device signed in to CandyFlix</b>\n{label}{place}\nAddress: {ip or 'unknown'}\n\nNot you? Change your password in Settings and sign the device out under Your devices.")
        except Exception:
            pass

    task = asyncio.get_running_loop().create_task(go())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def touch(user_id: uuid.UUID, token: str, ip: str | None) -> None:
    """Notes that a signed-in device is still using the site (at most every 5 minutes per sign-in). Never raises."""
    try:
        r = get_redis()
        if not await r.set(f"session_seen:{token}", "1", ex=SEEN_EVERY_SECONDS, nx=True):
            return
        device_id = (await auth_service.session_meta(token)).get("device")
        if not device_id:
            return
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(Device).where(Device.user_id == user_id, Device.device_id == device_id).values(last_seen=_now(), last_ip=ip, country=geo_service.country(ip))
            )
            await db.commit()
    except Exception:
        pass


async def adopt(db: AsyncSession, user: User, token: str, user_agent: str | None, ip: str | None) -> str:
    """A sign-in made before devices were tracked: give it a device now (no alerts). Returns the new device id."""
    device_id = new_device_id()
    await register(db, user, device_id, user_agent, ip)
    await auth_service.set_session_device(token, device_id)
    return device_id


async def overview(db: AsyncSession, user_id: uuid.UUID, cfg: DeviceConfig, current_device: str | None = None) -> DevicesOut:
    rows = (await db.execute(select(Device).where(Device.user_id == user_id).order_by(Device.last_seen.desc()))).scalars().all()
    live = await _live_devices(user_id)
    since = _now() - timedelta(hours=24)
    items = [
        DeviceOut(
            id=d.id, label=d.label, user_agent=d.user_agent, ip=d.last_ip, country=d.country, first_seen=d.first_seen, last_seen=d.last_seen,
            last_login_at=d.last_login_at, sign_ins=d.sign_ins, active=d.device_id in live, sessions=len(live.get(d.device_id, [])),
            current=bool(current_device) and d.device_id == current_device,
        )
        for d in rows
    ]
    return DevicesOut(
        items=items, active=sum(1 for i in items if i.active), today=sum(1 for d in rows if d.last_login_at >= since),
        limits_on=cfg.enabled, max_per_day=cfg.max_devices_per_day, max_active=cfg.max_active,
    )


async def end(db: AsyncSession, user_id: uuid.UUID, device_uuid: uuid.UUID) -> tuple[Device | None, int]:
    """Signs a device out everywhere. (None, 0) if this person has no such device."""
    device = (await db.execute(select(Device).where(Device.id == device_uuid, Device.user_id == user_id))).scalar_one_or_none()
    if device is None:
        return None, 0
    return device, await auth_service.revoke_device_sessions(user_id, device.device_id)


async def cleanup() -> int:
    async with AsyncSessionLocal() as db:
        res = await db.execute(delete(Device).where(Device.last_seen < _now() - timedelta(days=KEEP_DAYS)))
        await db.commit()
        return res.rowcount or 0
