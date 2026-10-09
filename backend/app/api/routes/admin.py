"""
/api/admin — admin-only. Every route depends on `require_admin` (403 for
everyone else); the safety rules (no self-lockout, at least one active
admin) are enforced in admin_service, not just in the UI.
"""
import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.models.user import User
from app.schemas import admin as schemas
from app.schemas.site import BadgePositionUpdate, BadgePublic, Footer, HomeBanners
from app.services import admin_service, audit_service, avatar_service, site_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _raise(exc: admin_service.AdminError):
    raise HTTPException(status_code=exc.status, detail=exc.message)


@router.get("/users", response_model=list[schemas.AdminUser])
async def list_users(db: AsyncSession = Depends(get_db)):
    return await admin_service.list_users(db)


@router.post("/users", response_model=schemas.AdminUser, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: schemas.AdminUserCreate, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    try:
        created = await admin_service.create_user(db, payload)
    except admin_service.AdminError as exc:
        _raise(exc)
    await audit_service.record(
        db, actor, "user.create", target_name=created.display_name, detail="Admin account" if created.is_admin else None
    )
    return created


async def _audit_user_update(db: AsyncSession, actor: User, after: schemas.AdminUser, before: tuple) -> None:
    username, display_name, is_admin, is_disabled = before
    plain = [label for label, old, new in (("username", username, after.username), ("display name", display_name, after.display_name)) if old != new]
    if plain:
        await audit_service.record(db, actor, "user.update", target_name=after.display_name, target=None, detail="Changed " + " and ".join(plain))
    if is_disabled != after.is_disabled:
        await audit_service.record(db, actor, "user.disable" if after.is_disabled else "user.enable", target_name=after.display_name)
    if is_admin != after.is_admin:
        await audit_service.record(db, actor, "user.make_admin" if after.is_admin else "user.remove_admin", target_name=after.display_name)


@router.patch("/users/{user_id}", response_model=schemas.AdminUser)
async def update_user(
    user_id: uuid.UUID,
    payload: schemas.AdminUserUpdate,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
        before = (target.username, target.display_name, target.is_admin, target.is_disabled)
        result = await admin_service.update_user(db, actor, target, payload)
    except admin_service.AdminError as exc:
        _raise(exc)
    await _audit_user_update(db, actor, result, before)
    return result


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
    await audit_service.record(db, actor, "user.password_reset", target=target)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
        name = target.display_name
        await admin_service.delete_user(db, actor, target)
    except admin_service.AdminError as exc:
        _raise(exc)
    await audit_service.record(db, actor, "user.delete", target_name=name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=schemas.AdminStats)
async def stats(db: AsyncSession = Depends(get_db)):
    return await admin_service.stats(db)


@router.get("/system", response_model=schemas.SystemStatus)
async def system(db: AsyncSession = Depends(get_db)):
    from app.main import app  # the version lives on the app object

    return await admin_service.system_status(db, app.version)


@router.post("/system/clear-tmdb-cache", response_model=schemas.ClearedResult)
async def clear_tmdb_cache(actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    cleared = await admin_service.clear_tmdb_cache()
    await audit_service.record(db, actor, "cache.tmdb_clear", detail=f"{cleared} entries")
    return schemas.ClearedResult(cleared=cleared)


@router.post("/system/clear-subtitle-cache", response_model=schemas.ClearedResult)
async def clear_subtitle_cache(actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    cleared = admin_service.clear_subtitle_cache()
    await audit_service.record(db, actor, "cache.subtitle_clear", detail=f"{cleared} files")
    return schemas.ClearedResult(cleared=cleared)


@router.get("/footer", response_model=Footer)
async def read_footer(db: AsyncSession = Depends(get_db)):
    return await site_service.get_footer(db)


@router.put("/footer", response_model=Footer)
async def update_footer(payload: Footer, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.set_footer(db, payload)
    await audit_service.record(db, actor, "footer.update")
    return saved


@router.get("/banners", response_model=HomeBanners)
async def read_banners(db: AsyncSession = Depends(get_db)):
    return await site_service.get_banners(db)


@router.put("/banners", response_model=HomeBanners)
async def update_banners(payload: HomeBanners, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.set_banners(db, payload)
    await audit_service.record(db, actor, "banners.update")
    return saved


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
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        page = await admin_service.watch_history(db, user_id, limit, offset)
        if offset == 0:
            await audit_service.record(
                db, actor, "history.view", target=await admin_service.get_user(db, user_id), dedupe=audit_service.VIEW_DEDUPE
            )
        return page
    except admin_service.AdminError as exc:
        _raise(exc)


@router.get("/users/{user_id}/watchlist", response_model=list[schemas.WatchlistEntry])
async def user_watchlist(user_id: uuid.UUID, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    try:
        items = await admin_service.user_watchlist(db, user_id)
        await audit_service.record(
            db, actor, "watchlist.view", target=await admin_service.get_user(db, user_id), dedupe=audit_service.VIEW_DEDUPE
        )
        return items
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


# --- Phase 10c: messages to people ("I understand") ---

from app.schemas import announcements as ann_schemas  # noqa: E402
from app.services import announcement_service  # noqa: E402


@router.get("/announcements", response_model=list[ann_schemas.AnnouncementOut])
async def list_announcements(db: AsyncSession = Depends(get_db)):
    return await announcement_service.list_all(db)


@router.post("/announcements", response_model=ann_schemas.AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    payload: ann_schemas.AnnouncementCreate, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    try:
        created = await announcement_service.create(db, actor, payload)
    except admin_service.AdminError as exc:
        _raise(exc)
    await audit_service.record(
        db, actor, "announcement.create", target_name=created.title,
        detail="For everyone" if created.audience == "all" else f"For {created.recipients} chosen people",
    )
    return created


@router.get("/announcements/{announcement_id}", response_model=ann_schemas.AnnouncementDetail)
async def announcement_detail(announcement_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        return await announcement_service.detail(db, announcement_id)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.get("/announcements/{announcement_id}/targets", response_model=list[uuid.UUID])
async def announcement_targets(announcement_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        await announcement_service.detail(db, announcement_id)  # 404 if missing
        return await announcement_service.target_ids(db, announcement_id)
    except admin_service.AdminError as exc:
        _raise(exc)


@router.patch("/announcements/{announcement_id}", response_model=ann_schemas.AnnouncementOut)
async def update_announcement(
    announcement_id: uuid.UUID,
    payload: ann_schemas.AnnouncementUpdate,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        updated = await announcement_service.update(db, announcement_id, payload)
    except admin_service.AdminError as exc:
        _raise(exc)
    only_toggle = payload.model_fields_set == {"is_active"}
    action = ("announcement.resume" if updated.is_active else "announcement.stop") if only_toggle else "announcement.update"
    await audit_service.record(db, actor, action, target_name=updated.title)
    return updated


@router.post("/announcements/{announcement_id}/reshow", response_model=schemas.ClearedResult)
async def reshow_announcement(
    announcement_id: uuid.UUID, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    try:
        title = (await announcement_service.detail(db, announcement_id)).title
        cleared = await announcement_service.reshow(db, announcement_id)
    except admin_service.AdminError as exc:
        _raise(exc)
    await audit_service.record(db, actor, "announcement.reshow", target_name=title)
    return schemas.ClearedResult(cleared=cleared)


@router.delete("/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: uuid.UUID, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    try:
        title = (await announcement_service.detail(db, announcement_id)).title
        await announcement_service.remove(db, announcement_id)
    except admin_service.AdminError as exc:
        _raise(exc)
    await audit_service.record(db, actor, "announcement.delete", target_name=title)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Phase 10d: audit trail ---


@router.get("/audit", response_model=schemas.AuditPage)
async def audit_trail(
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)
):
    return await audit_service.list_audit(db, limit, offset)


@router.get("/sign-in-log", response_model=schemas.SignInPage)
async def sign_in_log(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await audit_service.list_sign_ins(db, limit, offset, user_id)


@router.get("/ai", response_model=schemas.AdminAIOverview)
async def ai_overview(db: AsyncSession = Depends(get_db)):
    return await admin_service.ai_overview(db)


@router.put("/ai/config", response_model=schemas.AdminAIOverview)
async def update_ai_config(
    payload: schemas.AdminAIConfigUpdate, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    await admin_service.set_ai_config(db, payload)
    detail = (
        f"Search {'on' if payload.enabled else 'off'}, {payload.default_daily_limit} a day; "
        f"assistant {'on' if payload.watch_enabled else 'off'}, {payload.watch_daily_limit} a day"
    )
    await audit_service.record(db, actor, "ai.config", detail=detail)
    return await admin_service.ai_overview(db)


@router.put("/users/{user_id}/ai-history", response_model=schemas.AdminUser)
async def update_ai_history(
    user_id: uuid.UUID,
    payload: schemas.AdminAIHistoryUpdate,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await admin_service.get_user(db, user_id)
    except admin_service.AdminError as exc:
        _raise(exc)
    await admin_service.set_ai_history(db, target, payload.use_history)
    await audit_service.record(
        db, actor, "ai.history", target_name=target.display_name, detail="On" if payload.use_history else "Off"
    )
    return await admin_service._admin_view(db, target.id)


@router.get("/users/{user_id}/ai-searches", response_model=schemas.AISearchPage)
async def user_ai_searches(
    user_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        page = await admin_service.ai_searches(db, user_id, limit, offset)
        if offset == 0:
            await audit_service.record(
                db, actor, "ai.searches.view", target=await admin_service.get_user(db, user_id), dedupe=audit_service.VIEW_DEDUPE
            )
        return page
    except admin_service.AdminError as exc:
        _raise(exc)


@router.get("/badge", response_model=BadgePublic)
async def read_badge(db: AsyncSession = Depends(get_db)):
    return await site_service.get_badge(db)


@router.put("/badge", response_model=BadgePublic)
async def update_badge_position(
    payload: BadgePositionUpdate, actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    saved = await site_service.set_badge_position(db, payload.position)
    await audit_service.record(db, actor, "badge.update", detail=payload.position)
    return saved


@router.put("/badge/image", response_model=BadgePublic)
async def upload_badge_image(
    file: UploadFile = File(...), actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    data = await file.read(avatar_service.BADGE_MAX_BYTES + 1)
    try:
        png = avatar_service.process_badge(data)
    except avatar_service.AvatarError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    saved = await site_service.set_badge_image(db, png)
    await audit_service.record(db, actor, "badge.update", detail="New picture")
    return saved


@router.delete("/badge/image", response_model=BadgePublic)
async def remove_badge_image(actor: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    saved = await site_service.clear_badge_image(db)
    await audit_service.record(db, actor, "badge.update", detail="Back to the crown")
    return saved
