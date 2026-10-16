"""/api/admin/security (is an account being shared?) and /api/admin/notices (what the admins are told on the site)."""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.models.user import User
from app.schemas.security import NoticesOut, RestIn, SharingOverview
from app.schemas.site import SharingConfig
from app.services import audit_service, notice_service, sharing_service, site_service

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
