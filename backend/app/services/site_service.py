from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site_setting import SiteSetting
from app.schemas.site import Footer, HomeBanners

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
