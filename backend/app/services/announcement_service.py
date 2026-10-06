"""
Announcements: the admin writes a message, people see it at the top of the
site until they press "I understand", and the admin sees who has.

Who a message reaches:
- audience "all": every active (not disabled) person, including people added later;
- audience "selected": the people the admin picked.
A message is shown while it is active (not stopped), not expired and not yet
accepted by that person.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.announcement import Announcement, AnnouncementAck, AnnouncementTarget
from app.models.user import User
from app.schemas import announcements as schemas
from app.services.admin_service import AdminError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _status(a: Announcement, now: datetime) -> str:
    if not a.is_active:
        return "stopped"
    if a.expires_at is not None and _aware(a.expires_at) <= now:
        return "expired"
    return "active"


async def _get(db: AsyncSession, announcement_id: uuid.UUID) -> Announcement:
    a = await db.get(Announcement, announcement_id)
    if a is None:
        raise AdminError("That message doesn't exist.", 404)
    return a


async def _check_users(db: AsyncSession, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    unique = list(dict.fromkeys(ids))
    if not unique:
        raise AdminError("Pick at least one person.", 422)
    found = set((await db.execute(select(User.id).where(User.id.in_(unique)))).scalars().all())
    if len(found) != len(unique):
        raise AdminError("One of the chosen people doesn't exist.", 422)
    return unique


async def _recipients(db: AsyncSession, a: Announcement) -> list[tuple[User, datetime | None]]:
    """The people this message is for, with when each accepted it (or None)."""
    query = select(User, AnnouncementAck.acked_at).outerjoin(
        AnnouncementAck,
        and_(AnnouncementAck.user_id == User.id, AnnouncementAck.announcement_id == a.id),
    )
    if a.audience == "selected":
        query = query.join(AnnouncementTarget, AnnouncementTarget.user_id == User.id).where(
            AnnouncementTarget.announcement_id == a.id
        )
    else:
        query = query.where(User.is_disabled.is_(False))
    rows = (await db.execute(query.order_by(User.display_name))).all()
    return [(u, acked) for u, acked in rows]


async def _out(db: AsyncSession, a: Announcement, now: datetime) -> schemas.AnnouncementOut:
    people = await _recipients(db, a)
    author = await db.get(User, a.created_by) if a.created_by else None
    return schemas.AnnouncementOut(
        id=a.id,
        title=a.title,
        body=a.body,
        audience=a.audience,
        created_at=a.created_at,
        created_by_name=author.display_name if author else None,
        expires_at=a.expires_at,
        is_active=a.is_active,
        status=_status(a, now),
        recipients=len(people),
        accepted=sum(1 for _, acked in people if acked is not None),
    )


# ---------- admin ----------


async def list_all(db: AsyncSession) -> list[schemas.AnnouncementOut]:
    now = _now()
    rows = (await db.execute(select(Announcement).order_by(Announcement.created_at.desc()))).scalars().all()
    return [await _out(db, a, now) for a in rows]


async def detail(db: AsyncSession, announcement_id: uuid.UUID) -> schemas.AnnouncementDetail:
    a = await _get(db, announcement_id)
    base = await _out(db, a, _now())
    people = [
        schemas.Recipient(
            user_id=u.id, username=u.username, display_name=u.display_name, avatar_url=u.avatar_url, acked_at=acked
        )
        for u, acked in await _recipients(db, a)
    ]
    # Accepted first (latest first), then people still to accept.
    people.sort(key=lambda p: (p.acked_at is None, -(p.acked_at.timestamp() if p.acked_at else 0), p.display_name.lower()))
    return schemas.AnnouncementDetail(**base.model_dump(), people=people)


async def create(db: AsyncSession, actor: User, payload: schemas.AnnouncementCreate) -> schemas.AnnouncementOut:
    if payload.expires_at is not None and _aware(payload.expires_at) <= _now():
        raise AdminError("The end time has to be in the future.", 422)
    ids = await _check_users(db, payload.user_ids) if payload.audience == "selected" else []
    a = Announcement(
        title=payload.title,
        body=payload.body,
        audience=payload.audience,
        created_by=actor.id,
        expires_at=_aware(payload.expires_at),
    )
    db.add(a)
    await db.flush()
    db.add_all(AnnouncementTarget(announcement_id=a.id, user_id=uid) for uid in ids)
    await db.commit()
    await db.refresh(a)
    return await _out(db, a, _now())


async def update(db: AsyncSession, announcement_id: uuid.UUID, payload: schemas.AnnouncementUpdate) -> schemas.AnnouncementOut:
    a = await _get(db, announcement_id)
    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        a.title = payload.title
    if "body" in sent and payload.body is not None:
        a.body = payload.body
    if "is_active" in sent and payload.is_active is not None:
        a.is_active = payload.is_active
    if "expires_at" in sent:
        if payload.expires_at is not None and _aware(payload.expires_at) <= _now():
            raise AdminError("The end time has to be in the future.", 422)
        a.expires_at = _aware(payload.expires_at)
    audience = payload.audience if "audience" in sent and payload.audience else a.audience
    if audience == "selected":
        if "user_ids" in sent and payload.user_ids is not None:
            ids = await _check_users(db, payload.user_ids)
            await db.execute(delete(AnnouncementTarget).where(AnnouncementTarget.announcement_id == a.id))
            db.add_all(AnnouncementTarget(announcement_id=a.id, user_id=uid) for uid in ids)
        elif a.audience != "selected":
            raise AdminError("Pick at least one person.", 422)
    else:
        await db.execute(delete(AnnouncementTarget).where(AnnouncementTarget.announcement_id == a.id))
    a.audience = audience
    await db.commit()
    await db.refresh(a)
    return await _out(db, a, _now())


async def target_ids(db: AsyncSession, announcement_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (await db.execute(select(AnnouncementTarget.user_id).where(AnnouncementTarget.announcement_id == announcement_id)))
        .scalars()
        .all()
    )


async def reshow(db: AsyncSession, announcement_id: uuid.UUID) -> int:
    """Forget who accepted, so everyone sees it again. Returns how many acceptances were cleared."""
    a = await _get(db, announcement_id)
    result = await db.execute(delete(AnnouncementAck).where(AnnouncementAck.announcement_id == a.id))
    await db.commit()
    return result.rowcount or 0


async def remove(db: AsyncSession, announcement_id: uuid.UUID) -> None:
    await db.delete(await _get(db, announcement_id))
    await db.commit()


# ---------- people ----------


async def pending_for(db: AsyncSession, user: User) -> list[schemas.PendingAnnouncement]:
    now = _now()
    targeted = select(AnnouncementTarget.announcement_id).where(AnnouncementTarget.user_id == user.id)
    accepted = select(AnnouncementAck.announcement_id).where(AnnouncementAck.user_id == user.id)
    rows = (
        await db.execute(
            select(Announcement)
            .where(
                Announcement.is_active.is_(True),
                or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
                or_(Announcement.audience == "all", Announcement.id.in_(targeted)),
                Announcement.id.not_in(accepted),
            )
            .order_by(Announcement.created_at.desc())
        )
    ).scalars().all()
    return [schemas.PendingAnnouncement(id=a.id, title=a.title, body=a.body, created_at=a.created_at) for a in rows]


async def acknowledge(db: AsyncSession, user: User, announcement_id: uuid.UUID) -> None:
    """Idempotent. Only works for a message that was actually meant for this person."""
    a = await _get(db, announcement_id)
    if a.audience == "selected":
        mine = await db.scalar(
            select(func.count()).where(
                AnnouncementTarget.announcement_id == a.id, AnnouncementTarget.user_id == user.id
            )
        )
        if not mine:
            raise AdminError("That message doesn't exist.", 404)
    if await db.get(AnnouncementAck, (a.id, user.id)) is None:
        db.add(AnnouncementAck(announcement_id=a.id, user_id=user.id))
        await db.commit()
