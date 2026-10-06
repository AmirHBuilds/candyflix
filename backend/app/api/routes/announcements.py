"""/api/announcements — what the signed-in person still has to read, and "I understand"."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.announcements import PendingAnnouncement
from app.services import announcement_service
from app.services.admin_service import AdminError

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("/pending", response_model=list[PendingAnnouncement])
async def pending(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await announcement_service.pending_for(db, user)


@router.post("/{announcement_id}/ack", status_code=status.HTTP_204_NO_CONTENT)
async def acknowledge(announcement_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await announcement_service.acknowledge(db, user, announcement_id)
    except AdminError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
