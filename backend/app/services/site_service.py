from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site_setting import SiteSetting
from app.core.config import get_settings
from app.schemas.site import AIConfig, Footer, HomeBanners

FOOTER_KEY = "footer"


async def get_footer(db: AsyncSession) -> Footer:
    row = await db.get(SiteSetting, FOOTER_KEY)
    if row is None:
        return Footer()
    try:
        return Footer.model_validate(row.value)
    except Exception:
        return Footer()  # a bad stored value must never break every page


async def set_footer(db: AsyncSession, footer: Footer) -> Footer:
    data = footer.model_dump()
    row = await db.get(SiteSetting, FOOTER_KEY)
    if row is None:
        db.add(SiteSetting(key=FOOTER_KEY, value=data))
    else:
        row.value = data
    await db.commit()
    return footer


BANNERS_KEY = "home_banners"


async def get_banners(db: AsyncSession) -> HomeBanners:
    row = await db.get(SiteSetting, BANNERS_KEY)
    if row is None:
        return HomeBanners()
    try:
        return HomeBanners.model_validate(row.value)
    except Exception:
        return HomeBanners()  # a bad stored value must never break the home page


async def set_banners(db: AsyncSession, banners: HomeBanners) -> HomeBanners:
    data = banners.model_dump()
    row = await db.get(SiteSetting, BANNERS_KEY)
    if row is None:
        db.add(SiteSetting(key=BANNERS_KEY, value=data))
    else:
        row.value = data
    await db.commit()
    return banners


AI_KEY = "ai_config"


async def get_ai_config(db: AsyncSession) -> AIConfig:
    """What the admin chose; until they choose, the server's own default number applies."""
    row = await db.get(SiteSetting, AI_KEY)
    if row is not None:
        try:
            return AIConfig.model_validate(row.value)
        except Exception:
            pass  # a bad stored value must never break Ask AI
    return AIConfig(default_daily_limit=get_settings().ai_default_daily_limit)


async def set_ai_config(db: AsyncSession, config: AIConfig) -> AIConfig:
    data = config.model_dump()
    row = await db.get(SiteSetting, AI_KEY)
    if row is None:
        db.add(SiteSetting(key=AI_KEY, value=data))
    else:
        row.value = data
    await db.commit()
    return config
