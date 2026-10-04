import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_settings import VideoSettings
from app.models.watch_progress import NO_EPISODE, NO_SEASON
from app.schemas.video_settings import VideoSettingsPatch


def _identity(user_id, tmdb_id, media_type, season_number, episode_number):
    return (
        VideoSettings.user_id == user_id,
        VideoSettings.tmdb_id == tmdb_id,
        VideoSettings.media_type == media_type,
        VideoSettings.season_number == (NO_SEASON if season_number is None else season_number),
        VideoSettings.episode_number == (NO_EPISODE if episode_number is None else episode_number),
    )


async def get(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str,
              season_number: int | None, episode_number: int | None) -> dict:
    row = (
        await db.execute(select(VideoSettings).where(*_identity(user_id, tmdb_id, media_type, season_number, episode_number)))
    ).scalar_one_or_none()
    return dict(row.data) if row else {}


async def patch(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str,
                season_number: int | None, episode_number: int | None,
                changes: VideoSettingsPatch) -> dict:
    """Merges the sent keys into the stored document; a key sent as null is
    removed. Returns the stored document (an empty one deletes the row)."""
    sent = changes.model_dump(exclude_unset=True)
    current = await get(db, user_id, tmdb_id, media_type, season_number, episode_number)
    for key, value in sent.items():
        if value is None:
            current.pop(key, None)
        else:
            current[key] = value

    where = _identity(user_id, tmdb_id, media_type, season_number, episode_number)
    if not current:
        await db.execute(delete(VideoSettings).where(*where))
        await db.commit()
        return {}

    stmt = (
        insert(VideoSettings)
        .values(
            user_id=user_id, tmdb_id=tmdb_id, media_type=media_type,
            season_number=NO_SEASON if season_number is None else season_number,
            episode_number=NO_EPISODE if episode_number is None else episode_number,
            data=current,
        )
        .on_conflict_do_update(constraint="uq_video_settings_identity", set_={"data": current})
    )
    await db.execute(stmt)
    await db.commit()
    return current


async def delete_one(db: AsyncSession, user_id: uuid.UUID, tmdb_id: int, media_type: str,
                     season_number: int | None, episode_number: int | None) -> None:
    await db.execute(delete(VideoSettings).where(*_identity(user_id, tmdb_id, media_type, season_number, episode_number)))
    await db.commit()


async def delete_all(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(delete(VideoSettings).where(VideoSettings.user_id == user_id))
    await db.commit()
    return result.rowcount or 0
