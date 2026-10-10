"""/api/site — site content. Only the admin crown (the login screen shows it) is readable without signing in."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.site import BadgePublic, Footer, HomeBanners
from app.services import site_service

router = APIRouter(prefix="/site", tags=["site"])


@router.get("/footer", response_model=Footer)
async def read_footer(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await site_service.get_footer(db)


@router.get("/banners", response_model=HomeBanners)
async def read_banners(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await site_service.get_banners(db)


@router.get("/badge", response_model=BadgePublic)
async def read_badge(db: AsyncSession = Depends(get_db)):
    return await site_service.get_badge(db)
