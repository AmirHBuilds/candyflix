from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site_setting import SiteSetting
from app.core.config import get_settings
from app.schemas.site import AdminBadge, DeviceConfig, AIConfig, BadgePublic, Footer, HomeBanners, LoginGuardConfig, PlaybackConfig, SharingConfig, SocialConfig
from app.services import avatar_service

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
    env = get_settings()
    return AIConfig(default_daily_limit=env.ai_default_daily_limit, watch_daily_limit=env.watch_ai_default_daily_limit)


async def set_ai_config(db: AsyncSession, config: AIConfig) -> AIConfig:
    data = config.model_dump()
    row = await db.get(SiteSetting, AI_KEY)
    if row is None:
        db.add(SiteSetting(key=AI_KEY, value=data))
    else:
        row.value = data
    await db.commit()
    return config


SOCIAL_KEY = "social_config"


async def get_social_config(db: AsyncSession) -> SocialConfig:
    row = await db.get(SiteSetting, SOCIAL_KEY)
    if row is not None:
        try:
            return SocialConfig.model_validate(row.value)
        except Exception:
            pass
    return SocialConfig()


async def set_social_config(db: AsyncSession, config: SocialConfig) -> SocialConfig:
    row = await db.get(SiteSetting, SOCIAL_KEY)
    if row is None:
        db.add(SiteSetting(key=SOCIAL_KEY, value=config.model_dump()))
    else:
        row.value = config.model_dump()
    await db.commit()
    return config


PLAYBACK_KEY = "playback_config"


async def get_playback_config(db: AsyncSession) -> PlaybackConfig:
    row = await db.get(SiteSetting, PLAYBACK_KEY)
    if row is not None:
        try:
            return PlaybackConfig.model_validate(row.value)
        except Exception:
            pass
    return PlaybackConfig()


async def set_playback_config(db: AsyncSession, config: PlaybackConfig) -> PlaybackConfig:
    row = await db.get(SiteSetting, PLAYBACK_KEY)
    if row is None:
        db.add(SiteSetting(key=PLAYBACK_KEY, value=config.model_dump()))
    else:
        row.value = config.model_dump()
    await db.commit()
    return config


SHARING_KEY = "sharing_config"


async def get_sharing_config(db: AsyncSession) -> SharingConfig:
    row = await db.get(SiteSetting, SHARING_KEY)
    if row is not None:
        try:
            return SharingConfig.model_validate(row.value)
        except Exception:
            pass
    return SharingConfig()


async def set_sharing_config(db: AsyncSession, config: SharingConfig) -> SharingConfig:
    row = await db.get(SiteSetting, SHARING_KEY)
    if row is None:
        db.add(SiteSetting(key=SHARING_KEY, value=config.model_dump()))
    else:
        row.value = config.model_dump()
    await db.commit()
    return config


DEVICE_KEY = "device_config"


async def get_device_config(db: AsyncSession) -> DeviceConfig:
    row = await db.get(SiteSetting, DEVICE_KEY)
    if row is not None:
        try:
            return DeviceConfig.model_validate(row.value)
        except Exception:
            pass
    return DeviceConfig()


async def set_device_config(db: AsyncSession, config: DeviceConfig) -> DeviceConfig:
    row = await db.get(SiteSetting, DEVICE_KEY)
    if row is None:
        db.add(SiteSetting(key=DEVICE_KEY, value=config.model_dump()))
    else:
        row.value = config.model_dump()
    await db.commit()
    return config


LOGIN_GUARD_KEY = "login_guard_config"


async def get_login_guard_config(db: AsyncSession) -> LoginGuardConfig:
    row = await db.get(SiteSetting, LOGIN_GUARD_KEY)
    if row is not None:
        try:
            return LoginGuardConfig.model_validate(row.value)
        except Exception:
            pass
    return LoginGuardConfig()


async def set_login_guard_config(db: AsyncSession, config: LoginGuardConfig) -> LoginGuardConfig:
    row = await db.get(SiteSetting, LOGIN_GUARD_KEY)
    if row is None:
        db.add(SiteSetting(key=LOGIN_GUARD_KEY, value=config.model_dump()))
    else:
        row.value = config.model_dump()
    await db.commit()
    return config


BADGE_KEY = "admin_badge"


async def _get_badge(db: AsyncSession) -> AdminBadge:
    row = await db.get(SiteSetting, BADGE_KEY)
    if row is not None:
        try:
            return AdminBadge.model_validate(row.value)
        except Exception:
            pass  # a bad stored value must never break the login screen
    return AdminBadge()


async def _save_badge(db: AsyncSession, badge: AdminBadge) -> None:
    row = await db.get(SiteSetting, BADGE_KEY)
    if row is None:
        db.add(SiteSetting(key=BADGE_KEY, value=badge.model_dump()))
    else:
        row.value = badge.model_dump()
    await db.commit()


def _public(badge: AdminBadge) -> BadgePublic:
    return BadgePublic(position=badge.position, image_url=f"/avatars/{badge.image}" if badge.image else None)


async def get_badge(db: AsyncSession) -> BadgePublic:
    return _public(await _get_badge(db))


async def set_badge_position(db: AsyncSession, position: str) -> BadgePublic:
    badge = await _get_badge(db)
    badge.position = position  # type: ignore[assignment]
    await _save_badge(db, badge)
    return _public(badge)


async def set_badge_image(db: AsyncSession, png: bytes) -> BadgePublic:
    badge = await _get_badge(db)
    previous = badge.image
    badge.image = avatar_service.store_badge(png)
    await _save_badge(db, badge)
    avatar_service.remove(previous)
    return _public(badge)


async def clear_badge_image(db: AsyncSession) -> BadgePublic:
    badge = await _get_badge(db)
    previous = badge.image
    badge.image = None
    await _save_badge(db, badge)
    avatar_service.remove(previous)
    return _public(badge)
