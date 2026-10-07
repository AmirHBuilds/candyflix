"""/api/site — public site content (the footer is read by every page, even the login screen)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.schemas.site import Footer, HomeBanners
from app.services import site_service

router = APIRouter(prefix="/site", tags=["site"])


@router.get("/footer", response_model=Footer)
async def read_footer(db: AsyncSession = Depends(get_db)):
    return await site_service.get_footer(db)


@router.get("/banners", response_model=HomeBanners)
async def read_banners(db: AsyncSession = Depends(get_db)):
    return await site_service.get_banners(db)
