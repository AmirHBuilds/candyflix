"""/api/ai — "Ask AI" search."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.ai import AIStatus, AskRequest, AskResponse
from app.services import ai_service
from app.services.ai_service import AIError

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status", response_model=AIStatus)
async def ai_status(current_user: User = Depends(get_current_user)):
    return await ai_service.status(current_user)


@router.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await ai_service.ask(db, current_user, payload.prompt)
    except AIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
