from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site_setting import SiteSetting
from app.schemas.site import Footer

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
