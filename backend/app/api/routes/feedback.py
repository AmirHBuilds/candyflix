"""/api/feedback (anyone signed in may write) and /api/admin/feedback (admins read and mark handled)."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.core.db import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackIn, FeedbackOut, FeedbackPage
from app.services import telegram_service
from app.services.audit_service import device_label

DAILY_LIMIT = 10  # per person, so a stuck button can't flood the admins

router = APIRouter(prefix="/feedback", tags=["feedback"])
admin_router = APIRouter(prefix="/admin/feedback", tags=["admin"], dependencies=[Depends(require_admin)])


def _out(f: Feedback) -> FeedbackOut:
    return FeedbackOut(
        id=f.id, kind=f.kind, message=f.message, page=f.page, device=f.device, created_at=f.created_at,
        handled=f.handled, author_id=f.user_id, author_name=f.author_name,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def send(
    body: FeedbackIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_agent: str | None = Header(default=None),
):
    since = datetime.now(timezone.utc) - timedelta(days=1)
    sent = (await db.execute(select(func.count()).select_from(Feedback).where(Feedback.user_id == user.id, Feedback.created_at >= since))).scalar_one()
    if sent >= DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="That's plenty for today. Try again tomorrow.")
    name = user.display_name
    row = Feedback(
        user_id=user.id, author_name=name, kind=body.kind, message=body.message, page=body.page,
        device=device_label(user_agent) if user_agent else None,
    )
    db.add(row)
    await db.commit()
    telegram_service.report_feedback(name, body.kind, body.message, body.page)
    return {"ok": True}


@admin_router.get("", response_model=FeedbackPage)
async def list_feedback(
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    handled: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Feedback)
    if handled is not None:
        q = q.where(Feedback.handled == handled)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db.execute(q.order_by(Feedback.created_at.desc()).offset(offset).limit(limit))).scalars().all()
    unhandled = (await db.execute(select(func.count()).select_from(Feedback).where(Feedback.handled.is_(False)))).scalar_one()
    return FeedbackPage(items=[_out(r) for r in rows], total=total, unhandled=unhandled)


@admin_router.post("/{feedback_id}/handled", status_code=status.HTTP_204_NO_CONTENT)
async def mark(feedback_id: uuid.UUID, handled: bool = True, db: AsyncSession = Depends(get_db)):
    row = await db.get(Feedback, feedback_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That feedback is gone.")
    row.handled = handled
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.delete("/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(feedback_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Feedback).where(Feedback.id == feedback_id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
