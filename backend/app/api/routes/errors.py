"""/api/client-errors (a signed-in browser reports a problem) and /api/admin/errors (admins read the error log)."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.core.db import get_db
from app.core.redis import get_redis
from app.models.error_log import ErrorLog
from app.models.user import User
from app.schemas.error_log import ClientErrorIn, ErrorLogOut, ErrorLogPage
from app.services import error_log_service

HOURLY_LIMIT = 30  # per person, so a page stuck in a crash loop can't flood the log

router = APIRouter(prefix="/client-errors", tags=["errors"])
admin_router = APIRouter(prefix="/admin/errors", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def report(body: ClientErrorIn, user: User = Depends(get_current_user)):
    redis = get_redis()
    key = f"clienterr:{user.id}"
    n = await redis.incr(key)
    if n == 1:
        await redis.expire(key, 3600)
    if n > HOURLY_LIMIT:
        return {"ok": False}
    label = "Video player problem" if body.kind == "player" else "Page crashed"
    await error_log_service.record_now(
        "browser", f"{label}: {body.message}", body.detail, where=body.page, user=user.display_name, level="error",
    )
    return {"ok": True}


def _out(e: ErrorLog) -> ErrorLogOut:
    return ErrorLogOut(
        id=e.id, created_at=e.created_at, last_seen=e.last_seen, count=e.count, source=e.source, level=e.level,
        title=e.title, detail=e.detail, where=e.where, user_name=e.user_name, handled=e.handled,
    )


@admin_router.get("", response_model=ErrorLogPage)
async def list_errors(
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    source: str | None = None,
    level: str | None = None,
    handled: bool | None = None,
    q: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(ErrorLog)
    if source:
        query = query.where(ErrorLog.source == source)
    if level:
        query = query.where(ErrorLog.level == level)
    if handled is not None:
        query = query.where(ErrorLog.handled.is_(handled))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(ErrorLog.title.ilike(like) | ErrorLog.where.ilike(like) | ErrorLog.detail.ilike(like))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.execute(query.order_by(ErrorLog.last_seen.desc()).offset(offset).limit(limit))).scalars().all()
    unhandled = (await db.execute(select(func.count()).select_from(ErrorLog).where(ErrorLog.handled.is_(False)))).scalar_one()
    day = (await db.execute(select(func.count()).select_from(ErrorLog).where(ErrorLog.last_seen >= datetime.now(timezone.utc) - timedelta(days=1)))).scalar_one()
    per = (await db.execute(select(ErrorLog.source, func.count()).where(ErrorLog.handled.is_(False)).group_by(ErrorLog.source))).all()
    return ErrorLogPage(items=[_out(r) for r in rows], total=total, unhandled=unhandled, last_24h=day, by_source={s: c for s, c in per})


@admin_router.post("/{error_id}/handled", response_model=ErrorLogOut)
async def mark_handled(error_id: uuid.UUID, handled: bool = True, db: AsyncSession = Depends(get_db)):
    row = await db.get(ErrorLog, error_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That entry is gone.")
    row.handled = handled
    await db.commit()
    return _out(row)


@admin_router.post("/handle-all")
async def handle_all(source: str | None = None, db: AsyncSession = Depends(get_db)):
    stmt = update(ErrorLog).where(ErrorLog.handled.is_(False)).values(handled=True)
    if source:
        stmt = stmt.where(ErrorLog.source == source)
    res = await db.execute(stmt)
    await db.commit()
    return {"changed": res.rowcount or 0}


@admin_router.delete("/{error_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_error(error_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ErrorLog).where(ErrorLog.id == error_id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.post("/clear-handled")
async def clear_handled(db: AsyncSession = Depends(get_db)):
    res = await db.execute(delete(ErrorLog).where(ErrorLog.handled.is_(True)))
    await db.commit()
    return {"cleared": res.rowcount or 0}
