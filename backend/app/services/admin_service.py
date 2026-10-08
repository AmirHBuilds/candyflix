"""
Admin operations: managing accounts, the dashboard numbers, system health.

Safety rules live here (not just in the UI), because the UI can be bypassed:
- you can't switch off or delete your own account;
- there must always be at least one *active* admin (never lock everyone out);
- you can't reset your own password here (use Account settings, which also
  keeps your current session alive).
"""
import asyncio
import platform
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlalchemy import distinct, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.core.security import hash_password
from app.models.user import User
from app.models.watch_progress import WatchProgress
from app.models.watchlist_item import WatchlistItem
from app.schemas import admin as schemas
from app.services import auth_service, avatar_service, tmdb_service


class AdminError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------- users ----------


def _counts_query():
    watchlist = (
        select(func.count()).where(WatchlistItem.user_id == User.id).correlate(User).scalar_subquery()
    )
    watched = (
        select(func.count()).where(WatchProgress.user_id == User.id).correlate(User).scalar_subquery()
    )
    return select(User, watchlist.label("wl"), watched.label("wp"))


def _to_admin_user(user: User, wl: int, wp: int) -> schemas.AdminUser:
    result = schemas.AdminUser.model_validate(user)
    result.watchlist_count = wl
    result.watched_count = wp
    return result


async def list_users(db: AsyncSession) -> list[schemas.AdminUser]:
    rows = (await db.execute(_counts_query().order_by(User.created_at))).all()
    return [_to_admin_user(u, wl, wp) for u, wl, wp in rows]


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await auth_service.get_user_by_id(db, user_id)
    if user is None:
        raise AdminError("No such user.", status=404)
    return user


async def _admin_view(db: AsyncSession, user_id: uuid.UUID) -> schemas.AdminUser:
    row = (await db.execute(_counts_query().where(User.id == user_id))).one()
    await db.refresh(row[0])
    return _to_admin_user(*row)


async def _other_active_admins(db: AsyncSession, excluding: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).where(
                User.is_admin.is_(True), User.is_disabled.is_(False), User.id != excluding
            )
        )
    ) or 0


async def create_user(db: AsyncSession, payload: schemas.AdminUserCreate) -> schemas.AdminUser:
    if await auth_service.get_user_by_username(db, payload.username) is not None:
        raise AdminError(f"The username '{payload.username}' is already taken.", status=409)
    user = await auth_service.create_user(
        db, payload.username, payload.display_name, payload.password, is_admin=payload.is_admin
    )
    return await _admin_view(db, user.id)


async def update_user(
    db: AsyncSession, actor: User, target: User, changes: schemas.AdminUserUpdate
) -> schemas.AdminUser:
    data = changes.model_dump(exclude_unset=True, exclude_none=True)
    if "ai_daily_limit" in changes.model_fields_set:
        data["ai_daily_limit"] = changes.ai_daily_limit  # None is meaningful here: "use the default"

    if target.id == actor.id and data.get("is_disabled") is True:
        raise AdminError("You can't disable your own account.")

    will_be_active_admin = (data.get("is_admin", target.is_admin)) and not data.get(
        "is_disabled", target.is_disabled
    )
    is_active_admin = target.is_admin and not target.is_disabled
    if is_active_admin and not will_be_active_admin and await _other_active_admins(db, target.id) == 0:
        raise AdminError("There must always be at least one active admin.")

    new_username = data.get("username")
    if new_username and new_username != target.username:
        clash = await auth_service.get_user_by_username(db, new_username)
        if clash is not None and clash.id != target.id:
            raise AdminError(f"The username '{new_username}' is already taken.", status=409)

    for field, value in data.items():
        setattr(target, field, value)
    await db.commit()

    if data.get("is_disabled") is True:
        await auth_service.invalidate_user_sessions(target.id)
    return await _admin_view(db, target.id)


async def reset_password(db: AsyncSession, actor: User, target: User, new_password: str) -> int:
    """Returns how many of the person's sessions were ended."""
    if target.id == actor.id:
        raise AdminError("Use Account settings to change your own password.")
    target.password_hash = hash_password(new_password)
    await db.commit()
    return await auth_service.invalidate_user_sessions(target.id)


async def delete_user(db: AsyncSession, actor: User, target: User) -> None:
    if target.id == actor.id:
        raise AdminError("You can't delete your own account.")
    if target.is_admin and not target.is_disabled and await _other_active_admins(db, target.id) == 0:
        raise AdminError("There must always be at least one active admin.")
    avatar = target.avatar_path
    target_id = target.id
    await db.delete(target)  # watchlist, progress and settings go with it (ON DELETE CASCADE)
    await db.commit()
    avatar_service.remove(avatar)
    await auth_service.invalidate_user_sessions(target_id)


# ---------- dashboard ----------

ACTIVITY_DAYS = 14


async def _title_name(media_type: str, tmdb_id: int) -> str | None:
    try:
        if media_type == "movie":
            return (await tmdb_service.get_movie(tmdb_id)).title
        return (await tmdb_service.get_tv(tmdb_id)).title
    except Exception:  # a missing/unreachable title must never break the dashboard
        return None


async def stats(db: AsyncSession) -> schemas.AdminStats:
    now = datetime.now(timezone.utc)

    async def count(query) -> int:
        return (await db.scalar(query)) or 0

    users_total = await count(select(func.count()).select_from(User))
    admins = await count(select(func.count()).where(User.is_admin.is_(True)))
    disabled = await count(select(func.count()).where(User.is_disabled.is_(True)))
    active_7d = await count(select(func.count()).where(User.last_login_at >= now - timedelta(days=7)))
    watchlist_items = await count(select(func.count()).select_from(WatchlistItem))
    watched_items = await count(select(func.count()).select_from(WatchProgress))

    since = (now - timedelta(days=ACTIVITY_DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date(WatchProgress.updated_at)
    rows = (
        await db.execute(
            select(day, func.count(), func.count(distinct(WatchProgress.user_id)))
            .where(WatchProgress.updated_at >= since)
            .group_by(day)
        )
    ).all()
    by_day = {str(d): (saves, users) for d, saves, users in rows}
    activity = []
    for offset in range(ACTIVITY_DAYS):
        d: date = (since + timedelta(days=offset)).date()
        saves, active = by_day.get(d.isoformat(), (0, 0))
        activity.append(schemas.DayActivity(date=d.isoformat(), saves=saves, active_users=active))

    top_rows = (
        await db.execute(
            select(
                WatchProgress.tmdb_id,
                WatchProgress.media_type,
                func.count(distinct(WatchProgress.user_id)).label("viewers"),
            )
            .group_by(WatchProgress.tmdb_id, WatchProgress.media_type)
            .order_by(text("viewers DESC"), WatchProgress.tmdb_id)
            .limit(5)
        )
    ).all()
    names = await asyncio.gather(*[_title_name(mt, tid) for tid, mt, _ in top_rows])
    top_titles = [
        schemas.TopTitle(tmdb_id=tid, media_type=mt, title=name, viewers=viewers)
        for (tid, mt, viewers), name in zip(top_rows, names)
    ]

    recent = (
        await db.execute(
            select(User).where(User.last_login_at.is_not(None)).order_by(User.last_login_at.desc()).limit(5)
        )
    ).scalars().all()
    recent_logins = [
        schemas.RecentLogin(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            last_login_at=u.last_login_at,
        )
        for u in recent
    ]

    return schemas.AdminStats(
        users_total=users_total,
        admins=admins,
        disabled=disabled,
        active_last_7_days=active_7d,
        watchlist_items=watchlist_items,
        watched_items=watched_items,
        activity=activity,
        top_titles=top_titles,
        recent_logins=recent_logins,
    )


# ---------- system ----------


def _ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


async def _check_database(db: AsyncSession) -> schemas.ServiceCheck:
    start = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        return schemas.ServiceCheck(ok=True, detail="Connected", latency_ms=_ms(start))
    except Exception as exc:
        return schemas.ServiceCheck(ok=False, detail=f"Unreachable: {type(exc).__name__}")


async def _check_redis() -> schemas.ServiceCheck:
    start = time.perf_counter()
    try:
        await get_redis().ping()
        return schemas.ServiceCheck(ok=True, detail="Connected", latency_ms=_ms(start))
    except Exception as exc:
        return schemas.ServiceCheck(ok=False, detail=f"Unreachable: {type(exc).__name__}")


async def _check_tmdb() -> schemas.ServiceCheck:
    settings = get_settings()
    if not settings.tmdb_api_key:
        return schemas.ServiceCheck(ok=False, detail="TMDB_API_KEY is not set")
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(base_url=settings.tmdb_base_url, timeout=4.0) as client:
            response = await client.get("/configuration", params={"api_key": settings.tmdb_api_key})
    except httpx.RequestError as exc:
        return schemas.ServiceCheck(ok=False, detail=f"Can't reach TMDB: {type(exc).__name__}")
    if response.status_code == 401:
        return schemas.ServiceCheck(ok=False, detail="TMDB rejected the API key", latency_ms=_ms(start))
    if response.status_code != 200:
        return schemas.ServiceCheck(
            ok=False, detail=f"TMDB answered HTTP {response.status_code}", latency_ms=_ms(start)
        )
    return schemas.ServiceCheck(ok=True, detail="Reachable, API key accepted", latency_ms=_ms(start))


def _check_opensubtitles() -> schemas.ServiceCheck:
    # Configuration only — probing it would spend the (small) daily quota.
    if get_settings().opensubtitles_api_key:
        return schemas.ServiceCheck(ok=True, detail="API key configured")
    return schemas.ServiceCheck(ok=False, detail="OPENSUBTITLES_API_KEY is not set (subtitles disabled)")


def _check_omdb() -> schemas.ServiceCheck:
    # Configuration only: OMDb's free plan is 1000 lookups a day, and ratings
    # are fetched only when someone opens the ratings window.
    if get_settings().omdb_api_key:
        return schemas.ServiceCheck(ok=True, detail="API key configured (looked up only when ratings are opened)")
    return schemas.ServiceCheck(ok=False, detail="OMDB_API_KEY is not set (IMDb, Rotten Tomatoes and Metacritic ratings are hidden)")


def _check_gemini() -> schemas.ServiceCheck:
    # Configuration only: the free tier has a small daily quota that people's AI searches should use.
    settings = get_settings()
    if settings.gemini_api_key:
        return schemas.ServiceCheck(ok=True, detail=f"API key configured ({settings.gemini_model})")
    return schemas.ServiceCheck(ok=False, detail="GEMINI_API_KEY is not set (Ask AI is hidden)")


def _storage(directory: str) -> schemas.StorageInfo:
    path = Path(directory)
    if not path.is_dir():
        return schemas.StorageInfo(files=0, bytes=0)
    files = [p for p in path.iterdir() if p.is_file() and p.name != ".gitkeep"]
    return schemas.StorageInfo(files=len(files), bytes=sum(p.stat().st_size for p in files))


async def system_status(db: AsyncSession, app_version: str) -> schemas.SystemStatus:
    settings = get_settings()
    database, redis_check, tmdb = await asyncio.gather(_check_database(db), _check_redis(), _check_tmdb())
    return schemas.SystemStatus(
        database=database,
        redis=redis_check,
        tmdb=tmdb,
        opensubtitles=_check_opensubtitles(),
        omdb=_check_omdb(),
        gemini=_check_gemini(),
        subtitle_cache=_storage(settings.subtitle_cache_dir),
        avatars=_storage(settings.avatars_dir),
        app_version=app_version,
        python_version=platform.python_version(),
        auto_migrate=settings.auto_migrate,
        debug=settings.debug,
    )


async def clear_tmdb_cache() -> int:
    redis = get_redis()
    removed = 0
    async for key in redis.scan_iter(match="tmdb:*", count=200):
        removed += await redis.delete(key)
    return removed


def clear_subtitle_cache() -> int:
    removed = 0
    directory = Path(get_settings().subtitle_cache_dir)
    if directory.is_dir():
        for p in directory.iterdir():
            if p.is_file() and p.name != ".gitkeep":
                p.unlink(missing_ok=True)
                removed += 1
    return removed


# ---------- Phase 10a: what people are watching ----------


async def _titles(keys: set[tuple[str, int]]) -> dict[tuple[str, int], tuple[str | None, str | None]]:
    """(media_type, tmdb_id) -> (title, poster_path), from the cached TMDB lookups.
    A title TMDB can't give us is listed without a name rather than dropped."""

    async def one(key):
        media_type, tmdb_id = key
        try:
            detail = await (tmdb_service.get_movie(tmdb_id) if media_type == "movie" else tmdb_service.get_tv(tmdb_id))
            return key, (detail.title, detail.poster_path)
        except Exception:
            return key, (None, None)

    return dict(await asyncio.gather(*(one(k) for k in keys)))


def _none_if_sentinel(value: int) -> int | None:
    return None if value < 0 else value


async def now_watching(db: AsyncSession, only_user: uuid.UUID | None = None) -> list[schemas.NowWatching]:
    from app.services import presence_service

    if only_user is not None:
        one = await presence_service.get_now(only_user)
        entries = [(only_user, one)] if one else []
    else:
        entries = await presence_service.list_now()
    if not entries:
        return []
    users = {
        u.id: u
        for u in (await db.execute(select(User).where(User.id.in_([uid for uid, _ in entries])))).scalars().all()
    }
    titles = await _titles({(e["media_type"], e["tmdb_id"]) for _, e in entries})
    out = []
    for uid, e in entries:
        user = users.get(uid)
        if user is None or user.is_disabled:
            continue
        title, poster = titles.get((e["media_type"], e["tmdb_id"]), (None, None))
        out.append(
            schemas.NowWatching(
                user_id=uid,
                username=user.username,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
                tmdb_id=e["tmdb_id"],
                media_type=e["media_type"],
                season_number=e.get("season_number"),
                episode_number=e.get("episode_number"),
                title=title,
                poster_path=poster,
                position_seconds=e["position_seconds"],
                duration_seconds=e["duration_seconds"],
                playing=bool(e.get("playing")),
                since=datetime.fromtimestamp(e.get("since", e["at"]), timezone.utc),
                last_beat=datetime.fromtimestamp(e["at"], timezone.utc),
            )
        )
    out.sort(key=lambda n: n.since)
    return out


async def user_detail(db: AsyncSession, user_id: uuid.UUID) -> schemas.UserDetail:
    await get_user(db, user_id)  # 404 if missing
    admin_user = await _admin_view(db, user_id)
    now = await now_watching(db, only_user=user_id)
    sessions = await get_redis().scard(f"{auth_service.USER_SESSIONS_PREFIX}{user_id}")
    last = await db.scalar(select(func.max(WatchProgress.updated_at)).where(WatchProgress.user_id == user_id))
    return schemas.UserDetail(
        user=admin_user,
        now_watching=now[0] if now else None,
        active_sessions=int(sessions or 0),
        last_activity=last,
    )


async def watch_history(db: AsyncSession, user_id: uuid.UUID, limit: int, offset: int) -> schemas.HistoryPage:
    await get_user(db, user_id)
    total = await db.scalar(select(func.count()).where(WatchProgress.user_id == user_id)) or 0
    rows = (
        await db.execute(
            select(WatchProgress)
            .where(WatchProgress.user_id == user_id)
            .order_by(WatchProgress.updated_at.desc(), WatchProgress.id)
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    titles = await _titles({(r.media_type, r.tmdb_id) for r in rows})
    items = []
    for r in rows:
        title, poster = titles.get((r.media_type, r.tmdb_id), (None, None))
        opened_only = r.duration_seconds <= 0
        items.append(
            schemas.HistoryItem(
                tmdb_id=r.tmdb_id,
                media_type=r.media_type,
                season_number=_none_if_sentinel(r.season_number),
                episode_number=_none_if_sentinel(r.episode_number),
                title=title,
                poster_path=poster,
                position_seconds=r.position_seconds,
                duration_seconds=r.duration_seconds,
                fraction=None if opened_only else max(0.0, min(1.0, r.position_seconds / r.duration_seconds)),
                opened_only=opened_only,
                updated_at=r.updated_at,
            )
        )
    return schemas.HistoryPage(items=items, total=int(total))


async def user_watchlist(db: AsyncSession, user_id: uuid.UUID) -> list[schemas.WatchlistEntry]:
    await get_user(db, user_id)
    rows = (
        await db.execute(
            select(WatchlistItem).where(WatchlistItem.user_id == user_id).order_by(WatchlistItem.added_at.desc())
        )
    ).scalars().all()
    titles = await _titles({(r.media_type, r.tmdb_id) for r in rows})
    return [
        schemas.WatchlistEntry(
            tmdb_id=r.tmdb_id,
            media_type=r.media_type,
            title=titles.get((r.media_type, r.tmdb_id), (None, None))[0],
            poster_path=titles.get((r.media_type, r.tmdb_id), (None, None))[1],
            added_at=r.added_at,
        )
        for r in rows
    ]


# ---------- Phase 10b: drill-down lists ----------


async def titles_watched(db: AsyncSession, limit: int, offset: int) -> schemas.TitlePage:
    """Every title anyone has watched, most-watched first."""
    key = (WatchProgress.tmdb_id, WatchProgress.media_type)
    grouped = select(*key).group_by(*key).subquery()
    total = await db.scalar(select(func.count()).select_from(grouped)) or 0
    rows = (
        await db.execute(
            select(
                *key,
                func.count(distinct(WatchProgress.user_id)).label("viewers"),
                func.count().label("entries"),
                func.max(WatchProgress.updated_at).label("last"),
            )
            .group_by(*key)
            .order_by(text("viewers DESC"), text("last DESC"), WatchProgress.tmdb_id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    titles = await _titles({(mt, tid) for tid, mt, *_ in rows})
    items = [
        schemas.TitleRow(
            tmdb_id=tid,
            media_type=mt,
            title=titles.get((mt, tid), (None, None))[0],
            poster_path=titles.get((mt, tid), (None, None))[1],
            viewers=viewers,
            entries=entries,
            last_watched_at=last,
        )
        for tid, mt, viewers, entries, last in rows
    ]
    return schemas.TitlePage(items=items, total=int(total))


async def _viewer_items(db: AsyncSession, where, limit: int, offset: int) -> schemas.ViewerPage:
    total = await db.scalar(select(func.count()).select_from(WatchProgress).where(*where)) or 0
    rows = (
        await db.execute(
            select(WatchProgress, User)
            .join(User, User.id == WatchProgress.user_id)
            .where(*where)
            .order_by(WatchProgress.updated_at.desc(), WatchProgress.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    titles = await _titles({(r.media_type, r.tmdb_id) for r, _ in rows})
    items = []
    for r, u in rows:
        title, poster = titles.get((r.media_type, r.tmdb_id), (None, None))
        opened_only = r.duration_seconds <= 0
        items.append(
            schemas.ViewerItem(
                tmdb_id=r.tmdb_id,
                media_type=r.media_type,
                season_number=_none_if_sentinel(r.season_number),
                episode_number=_none_if_sentinel(r.episode_number),
                title=title,
                poster_path=poster,
                position_seconds=r.position_seconds,
                duration_seconds=r.duration_seconds,
                fraction=None if opened_only else max(0.0, min(1.0, r.position_seconds / r.duration_seconds)),
                opened_only=opened_only,
                updated_at=r.updated_at,
                user_id=u.id,
                username=u.username,
                display_name=u.display_name,
                avatar_url=u.avatar_url,
            )
        )
    return schemas.ViewerPage(items=items, total=int(total))


async def title_viewers(db: AsyncSession, media_type: str, tmdb_id: int, limit: int, offset: int) -> schemas.ViewerPage:
    """Who has watched one title (and how far), latest first."""
    return await _viewer_items(
        db, [WatchProgress.media_type == media_type, WatchProgress.tmdb_id == tmdb_id], limit, offset
    )


async def day_activity(db: AsyncSession, day: date, limit: int, offset: int) -> schemas.ViewerPage:
    """Everything saved on one calendar day (UTC, the same day the Overview chart groups by)."""
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return await _viewer_items(
        db, [WatchProgress.updated_at >= start, WatchProgress.updated_at < start + timedelta(days=1)], limit, offset
    )


async def sign_ins(db: AsyncSession) -> list[schemas.LoginRow]:
    """Everyone with their last sign-in and how many sign-ins are active now, most recent first."""
    users = (await db.execute(select(User))).scalars().all()
    redis = get_redis()
    counts = {u.id: int(await redis.scard(f"{auth_service.USER_SESSIONS_PREFIX}{u.id}") or 0) for u in users}
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    users.sort(key=lambda u: u.last_login_at or epoch, reverse=True)
    return [
        schemas.LoginRow(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            is_disabled=u.is_disabled,
            last_login_at=u.last_login_at,
            active_sessions=counts[u.id],
        )
        for u in users
    ]
