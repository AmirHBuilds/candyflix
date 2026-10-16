"""/api/admin/security (is an account being shared?) and /api/admin/notices (what the admins are told on the site)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.models.user import User
from app.schemas.security import LoginBlockOut, LoginEventOut, LoginsOverview, NoTwoStep, NoticesOut, RestIn, SharingOverview
from app.schemas.devices import DevicesOut
from app.schemas.site import DeviceConfig, LoginGuardConfig, SharingConfig
from app.services import audit_service, auth_service, device_service, geo_service, login_guard_service, notice_service, sharing_service, site_service, telegram_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/security/sharing", response_model=SharingOverview)
async def sharing(hours: int | None = Query(default=None, ge=1, le=720), db: AsyncSession = Depends(get_db)):
    cfg = await site_service.get_sharing_config(db)
    return await sharing_service.overview(db, cfg, hours)


@router.get("/security/sharing-config", response_model=SharingConfig)
async def read_sharing_config(db: AsyncSession = Depends(get_db)):
    return await site_service.get_sharing_config(db)


@router.put("/security/sharing-config", response_model=SharingConfig)
async def update_sharing_config(payload: SharingConfig, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.set_sharing_config(db, payload)
    await audit_service.record(db, actor, "sharing.config", detail=f"{'on' if saved.enabled else 'off'}: {saved.max_ips} addresses in {saved.window_hours}h")
    return saved


@router.get("/security/logins", response_model=LoginsOverview)
async def logins(db: AsyncSession = Depends(get_db)):
    """Who is blocked right now, the recent wrong passwords, and who has no two-step sign-in."""
    cfg = await site_service.get_login_guard_config(db)
    blocks = await login_guard_service.list_blocks()
    events = await login_guard_service.events(db)
    available = telegram_service.enabled()
    users = await auth_service.list_users(db) if available else []
    return LoginsOverview(
        config=cfg,
        blocks=[LoginBlockOut(scope=b.scope, key=b.key, seconds_left=b.seconds_left, since=b.since, until=b.until, fails=b.fails, minutes=b.minutes, strikes=b.strikes, others=b.others or []) for b in blocks],
        events=[LoginEventOut(id=e.id, at=e.at, kind=e.kind, username=e.username, ip=e.ip, detail=e.detail) for e in events],
        two_step_available=available,
        without_two_step=[
            NoTwoStep(user_id=u.id, username=u.username, display_name=u.display_name, is_admin=u.is_admin)
            for u in users
            if not u.is_disabled and not u.two_factor_enabled
        ],
    )


@router.put("/security/login-config", response_model=LoginGuardConfig)
async def update_login_config(payload: LoginGuardConfig, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.set_login_guard_config(db, payload)
    detail = "off" if not saved.enabled else f"{saved.name_failures} per name / {saved.ip_failures} per address in {saved.window_minutes} min, block {saved.lockout_minutes} min"
    await audit_service.record(db, actor, "login.config", detail=detail)
    return saved


@router.delete("/security/blocks", status_code=status.HTTP_204_NO_CONTENT)
async def lift_block(
    scope: str = Query(pattern="^(name|ip)$"),
    key: str = Query(min_length=1, max_length=100),
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not await login_guard_service.clear(scope, key):
        raise HTTPException(status_code=404, detail="That block has already ended.")
    await audit_service.record(db, actor, "login.unblock", target_name=key, detail=f"{'name' if scope == 'name' else 'address'} block lifted")


class DeviceConfigOut(DeviceConfig):
    country_available: bool  # the server has the IP-to-country file


@router.get("/security/device-config", response_model=DeviceConfigOut)
async def read_device_config(db: AsyncSession = Depends(get_db)):
    return DeviceConfigOut(**(await site_service.get_device_config(db)).model_dump(), country_available=geo_service.available())


@router.put("/security/device-config", response_model=DeviceConfigOut)
async def update_device_config(payload: DeviceConfig, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.set_device_config(db, payload)
    detail = "off" if not saved.enabled else f"{saved.max_devices_per_day} devices a day, {saved.max_active} at once, at the limit: {saved.action}"
    await audit_service.record(db, actor, "device.config", detail=detail)
    return DeviceConfigOut(**saved.model_dump(), country_available=geo_service.available())


@router.get("/users/{user_id}/devices", response_model=DevicesOut)
async def person_devices(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    target = await auth_service.get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="No such person.")
    return await device_service.overview(db, user_id, await site_service.get_device_config(db))


@router.delete("/users/{user_id}/devices/{device_uuid}")
async def end_person_device(user_id: uuid.UUID, device_uuid: uuid.UUID, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Signs one of their devices out."""
    target = await auth_service.get_user_by_id(db, user_id)
    device, ended = await device_service.end(db, user_id, device_uuid)
    if target is None or device is None:
        raise HTTPException(status_code=404, detail="That device isn't on this account.")
    await audit_service.record(db, actor, "device.end", target=target, detail=f"{device.label}, {ended} sign-in{'s' if ended != 1 else ''} ended")
    return {"ended": ended}


@router.get("/notices", response_model=NoticesOut)
async def notices(actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await notice_service.read(db, actor)


@router.post("/notices/read", status_code=status.HTTP_204_NO_CONTENT)
async def notices_read(actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await notice_service.mark_read(db, actor)


@router.put("/notices/rest", response_model=NoticesOut)
async def notices_rest(payload: RestIn, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await notice_service.set_rest(db, actor, payload.minutes)
    return await notice_service.read(db, actor)
