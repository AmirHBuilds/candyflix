"""
/api/admin — admin-only. Every route depends on `require_admin` (403 for
everyone else); the safety rules (no self-lockout, at least one active
admin) are enforced in admin_service, not just in the UI.
"""
import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.models.user import User
from app.schemas import admin as schemas
from app.schemas.site import Footer
from app.services import admin_service, site_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _raise(exc: admin_service.AdminError):
    raise HTTPException(status_code=exc.status, detail=exc.message)


@router.get("/users", response_model=list[schemas.AdminUser])
async def list_users(db: AsyncSession = Depends(get_db)):
    return await admin_service.list_users(db)


@router.post("/users", response_model=schemas.AdminUser, status_code=status.HTTP_201_CREATED)
async def create_user(payload: schemas.AdminUserCreate, db: AsyncSession = Depends(get_db)):
    try:
        return await admin_service.create_user(db, payload)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.patch("/users/{user_id}", response_model=schemas.AdminUser)
async def update_user(
    user_id: uuid.UUID,
    payload: schemas.AdminUserUpdate,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
        return await admin_service.update_user(db, actor, target, payload)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: uuid.UUID,
    payload: schemas.AdminPasswordReset,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
        await admin_service.reset_password(db, actor, target, payload.new_password)
    except admin_service.AdminError as exc:
        _raise(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
        await admin_service.delete_user(db, actor, target)
    except admin_service.AdminError as exc:
        _raise(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=schemas.AdminStats)
async def stats(db: AsyncSession = Depends(get_db)):
    return await admin_service.stats(db)


@router.get("/system", response_model=schemas.SystemStatus)
async def system(db: AsyncSession = Depends(get_db)):
    from app.main import app  # the version lives on the app object

    return await admin_service.system_status(db, app.version)


@router.post("/system/clear-tmdb-cache", response_model=schemas.ClearedResult)
async def clear_tmdb_cache():
    return schemas.ClearedResult(cleared=await admin_service.clear_tmdb_cache())


@router.post("/system/clear-subtitle-cache", response_model=schemas.ClearedResult)
async def clear_subtitle_cache():
    return schemas.ClearedResult(cleared=admin_service.clear_subtitle_cache())


@router.get("/footer", response_model=Footer)
async def read_footer(db: AsyncSession = Depends(get_db)):
    return await site_service.get_footer(db)


@router.put("/footer", response_model=Footer)
async def update_footer(payload: Footer, db: AsyncSession = Depends(get_db)):
    return await site_service.set_footer(db, payload)


# --- Phase 10a: what people are watching (admins see all of it; people are told, see Settings -> Privacy & data) ---


@router.get("/now-watching", response_model=list[schemas.NowWatching])
async def now_watching(db: AsyncSession = Depends(get_db)):
    return await admin_service.now_watching(db)


@router.get("/users/{user_id}/detail", response_model=schemas.UserDetail)
async def user_detail(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        return await admin_service.user_detail(db, user_id)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.get("/users/{user_id}/history", response_model=schemas.HistoryPage)
async def user_history(
    user_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await admin_service.watch_history(db, user_id, limit, offset)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.get("/users/{user_id}/watchlist", response_model=list[schemas.WatchlistEntry])
async def user_watchlist(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        return await admin_service.user_watchlist(db, user_id)
    except admin_service.AdminError as exc:
        _raise(exc)


# --- Phase 10b: drill-down lists behind every Overview number ---


@router.get("/titles", response_model=schemas.TitlePage)
async def titles_watched(
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)
):
    return await admin_service.titles_watched(db, limit, offset)


@router.get("/titles/{media_type}/{tmdb_id}/viewers", response_model=schemas.ViewerPage)
async def title_viewers(
    media_type: Literal["movie", "tv"],
    tmdb_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.title_viewers(db, media_type, tmdb_id, limit, offset)


@router.get("/activity/{day}", response_model=schemas.ViewerPage)
async def day_activity(
    day: date, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)
):
    return await admin_service.day_activity(db, day, limit, offset)


@router.get("/sign-ins", response_model=list[schemas.LoginRow])
async def sign_ins(db: AsyncSession = Depends(get_db)):
    return await admin_service.sign_ins(db)
