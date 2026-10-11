"""
Opinions and likes: the rules.

- Everything is switchable: by the admin for the whole site (SocialConfig), by each person for themselves
  (their `social` settings), and an admin can stop one person from posting (`opinions_blocked`).
- A title the viewer's age limit rules out is never shown or accepted.
- Anonymous opinions show "Someone" to people; admins can still see who wrote them.
- Likes: a person who switched off "share my likes" still can like, but nobody else sees it (or counts it).
- Replies are one level deep and never notify anybody.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.models.opinion import WHOLE, Opinion, OpinionLike, TitleLike
from app.models.user import User
from app.models.user_settings import UserSettings as UserSettingsRow
from app.schemas import opinions as s
from app.services import content_rating_service, site_service, tmdb_service

MAX_PER_HOUR = 20
PEOPLE_SHOWN = 3
FEED_TITLES = 12
FEED_DAYS = 45


class Flags:
    """What one person chose in Settings → Community."""

    def __init__(self, enabled=True, share_likes=True, anonymous_by_default=False, show_on_home=True):
        self.enabled, self.share_likes, self.anonymous_by_default, self.show_on_home = enabled, share_likes, anonymous_by_default, show_on_home


async def flags_for(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, Flags]:
    out = {i: Flags() for i in ids}
    if not ids:
        return out
    rows = await db.execute(select(UserSettingsRow.user_id, UserSettingsRow.data).where(UserSettingsRow.user_id.in_(ids)))
    for uid, data in rows.all():
        social = (data or {}).get("social") or {}
        out[uid] = Flags(
            enabled=social.get("enabled", True) is not False,
            share_likes=social.get("share_likes", True) is not False,
            anonymous_by_default=social.get("anonymous_by_default", False) is True,
            show_on_home=social.get("show_on_home", True) is not False,
        )
    return out


def _person(u: User) -> s.Person:
    return s.Person(id=u.id, name=u.display_name, avatar_url=u.avatar_url)


def _scope_where(model, scope: s.Scope):
    return (
        model.media_type == scope.media_type,
        model.tmdb_id == scope.tmdb_id,
        model.season_number == scope.season_number,
        model.episode_number == scope.episode_number,
    )


async def _on(db: AsyncSession, user: User) -> tuple[bool, "site_service.SocialConfig", Flags]:
    config = await site_service.get_social_config(db)
    flags = (await flags_for(db, [user.id]))[user.id]
    return config.enabled and flags.enabled, config, flags


# ---------------------------------------------------------------- likes on a title


async def like_summary(db: AsyncSession, user: User, scope: s.Scope) -> s.LikeSummary:
    rows = (
        await db.execute(
            select(TitleLike.user_id, TitleLike.created_at).where(*_scope_where(TitleLike, scope)).order_by(TitleLike.created_at.desc())
        )
    ).all()
    ids = [r[0] for r in rows]
    flags = await flags_for(db, ids)
    visible = [uid for uid in ids if uid != user.id and flags[uid].share_likes and flags[uid].enabled]
    you = user.id in ids
    users = {}
    if visible:
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(visible[:PEOPLE_SHOWN])))).scalars()}
    people = [_person(users[i]) for i in visible[:PEOPLE_SHOWN] if i in users]
    return s.LikeSummary(count=len(visible) + (1 if you else 0), you_liked=you, people=people, more=max(0, len(visible) - PEOPLE_SHOWN))


async def set_title_like(db: AsyncSession, user: User, body: s.LikeSet) -> s.LikeSummary:
    await content_rating_service.ensure(user, body.media_type, body.tmdb_id)
    enabled, _, _ = await _on(db, user)
    if not enabled:
        raise HTTPException(403, "Likes are switched off for you.")
    where = (TitleLike.user_id == user.id, *_scope_where(TitleLike, body))
    existing = await db.scalar(select(TitleLike.id).where(*where))
    if body.liked and existing is None:
        db.add(TitleLike(user_id=user.id, media_type=body.media_type, tmdb_id=body.tmdb_id, season_number=body.season_number, episode_number=body.episode_number))
        await db.commit()
    elif not body.liked and existing is not None:
        await db.execute(delete(TitleLike).where(*where))
        await db.commit()
    return await like_summary(db, user, body)


# ---------------------------------------------------------------- opinions


async def _opinion_outs(db: AsyncSession, user: User, rows: list[Opinion], authors: dict[uuid.UUID, User]) -> dict[uuid.UUID, s.OpinionOut]:
    ids = [o.id for o in rows]
    counts: dict[uuid.UUID, int] = {}
    mine: set[uuid.UUID] = set()
    if ids:
        counts = dict((await db.execute(select(OpinionLike.opinion_id, func.count()).where(OpinionLike.opinion_id.in_(ids)).group_by(OpinionLike.opinion_id))).all())
        mine = set((await db.execute(select(OpinionLike.opinion_id).where(OpinionLike.opinion_id.in_(ids), OpinionLike.user_id == user.id))).scalars())
    out = {}
    for o in rows:
        author = authors.get(o.user_id)
        is_mine = o.user_id == user.id
        out[o.id] = s.OpinionOut(
            id=o.id,
            body=o.body,
            created_at=o.created_at,
            author=None if o.is_anonymous or author is None else _person(author),
            is_anonymous=o.is_anonymous,
            mine=is_mine,
            likes=counts.get(o.id, 0),
            liked_by_me=o.id in mine,
            season_number=o.season_number,
            episode_number=o.episode_number,
            real_author=(author.display_name if author and o.is_anonymous and user.is_admin and not is_mine else None),
            hidden=o.is_hidden if user.is_admin else False,
        )
    return out


async def for_title(db: AsyncSession, user: User, scope: s.Scope) -> s.TitleOpinions:
    await content_rating_service.ensure(user, scope.media_type, scope.tmdb_id)
    on, config, flags = await _on(db, user)
    if not on:
        return s.TitleOpinions(enabled=False)

    if scope.season_number < 0:
        # The whole title: also what was said about its episodes (each opinion says where it belongs).
        where = [Opinion.media_type == scope.media_type, Opinion.tmdb_id == scope.tmdb_id]
    else:
        where = [*_scope_where(Opinion, scope)]
    if not user.is_admin:
        where.append(Opinion.is_hidden.is_(False))
    rows = list((await db.execute(select(Opinion).where(*where).order_by(Opinion.created_at))).scalars())
    author_ids = list({o.user_id for o in rows})
    authors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars()} if author_ids else {}
    outs = await _opinion_outs(db, user, rows, authors)

    top: list[s.OpinionOut] = []
    for o in rows:
        if o.parent_id is None:
            top.append(outs[o.id])
        elif o.parent_id in outs:
            outs[o.parent_id].replies.append(outs[o.id])
    top.reverse()  # newest first; replies stay oldest first

    can, why = True, None
    if user.opinions_blocked:
        can, why = False, "An admin has switched off commenting for you."
    return s.TitleOpinions(
        enabled=True,
        moderator=bool(user.is_admin),
        can_comment=can,
        why_not=why,
        allow_anonymous=config.allow_anonymous,
        allow_replies=config.allow_replies,
        anonymous_default=flags.anonymous_by_default and config.allow_anonymous,
        likes=await like_summary(db, user, scope),
        comment_count=len(rows) if not user.is_admin else sum(1 for o in rows if not o.is_hidden),
        opinions=top[:100],
    )


async def post(db: AsyncSession, user: User, body: s.OpinionCreate) -> s.OpinionOut:
    await content_rating_service.ensure(user, body.media_type, body.tmdb_id)
    on, config, _ = await _on(db, user)
    if not on:
        raise HTTPException(403, "Opinions are switched off.")
    if user.opinions_blocked:
        raise HTTPException(403, "An admin has switched off commenting for you.")
    if body.anonymous and not config.allow_anonymous:
        raise HTTPException(400, "Anonymous opinions are switched off.")
    if body.parent_id is not None:
        if not config.allow_replies:
            raise HTTPException(400, "Replies are switched off.")
        parent = await db.get(Opinion, body.parent_id)
        if parent is None or parent.is_hidden or parent.parent_id is not None or (parent.media_type, parent.tmdb_id, parent.season_number, parent.episode_number) != (body.media_type, body.tmdb_id, body.season_number, body.episode_number):
            raise HTTPException(404, "That opinion isn't there any more.")

    redis = get_redis()
    key = f"opinions:rate:{user.id}"
    used = await redis.incr(key)
    if used == 1:
        await redis.expire(key, 3600)
    if used > MAX_PER_HOUR:
        raise HTTPException(429, "Slow down a little. Try again in a while.")

    row = Opinion(
        user_id=user.id, media_type=body.media_type, tmdb_id=body.tmdb_id, season_number=body.season_number,
        episode_number=body.episode_number, parent_id=body.parent_id, body=body.body, is_anonymous=body.anonymous,
    )
    db.add(row)
    await db.commit()
    return (await _opinion_outs(db, user, [row], {user.id: user}))[row.id]


async def delete_opinion(db: AsyncSession, user: User, opinion_id: uuid.UUID) -> None:
    row = await db.get(Opinion, opinion_id)
    if row is None:
        return
    if row.user_id != user.id and not user.is_admin:
        raise HTTPException(403, "That isn't yours to delete.")
    await db.delete(row)
    await db.commit()


async def set_opinion_like(db: AsyncSession, user: User, opinion_id: uuid.UUID, liked: bool) -> s.OpinionLikeResult:
    row = await db.get(Opinion, opinion_id)
    if row is None or (row.is_hidden and not user.is_admin):
        raise HTTPException(404, "That opinion isn't there any more.")
    await content_rating_service.ensure(user, row.media_type, row.tmdb_id)
    on, _, _ = await _on(db, user)
    if not on:
        raise HTTPException(403, "Likes are switched off for you.")
    where = (OpinionLike.user_id == user.id, OpinionLike.opinion_id == opinion_id)
    existing = await db.scalar(select(OpinionLike.id).where(*where))
    if liked and existing is None:
        db.add(OpinionLike(user_id=user.id, opinion_id=opinion_id))
        await db.commit()
    elif not liked and existing is not None:
        await db.execute(delete(OpinionLike).where(*where))
        await db.commit()
    count = await db.scalar(select(func.count()).select_from(OpinionLike).where(OpinionLike.opinion_id == opinion_id)) or 0
    return s.OpinionLikeResult(likes=int(count), liked_by_me=liked)


# ---------------------------------------------------------------- the home page strip


async def _title_info(media_type: str, tmdb_id: int) -> tuple[str, str | None, str | None] | None:
    try:
        d = await (tmdb_service.get_movie(tmdb_id) if media_type == "movie" else tmdb_service.get_tv(tmdb_id))
    except Exception:
        return None
    return d.title, d.poster_path, d.backdrop_path


async def summaries(db: AsyncSession, user: User, keys: list[tuple[str, int]], *, with_titles: bool = True) -> list[s.FeedTitle]:
    """One card per title with other people's newest opinion, how many they wrote, and who liked it. Titles nobody touched are left out."""
    if not keys:
        return []
    media = {m for m, _ in keys}
    ids = {i for _, i in keys}
    wanted = set(keys)

    ops = [
        o
        for o in (
            await db.execute(
                select(Opinion)
                .where(Opinion.media_type.in_(media), Opinion.tmdb_id.in_(ids), Opinion.is_hidden.is_(False), Opinion.user_id != user.id)
                .order_by(Opinion.created_at.desc())
                .limit(600)
            )
        ).scalars()
        if (o.media_type, o.tmdb_id) in wanted
    ]
    likes = [
        r
        for r in (
            await db.execute(
                select(TitleLike).where(
                    TitleLike.media_type.in_(media), TitleLike.tmdb_id.in_(ids), TitleLike.season_number == WHOLE,
                    TitleLike.episode_number == WHOLE, TitleLike.user_id != user.id,
                ).order_by(TitleLike.created_at.desc())
            )
        ).scalars()
        if (r.media_type, r.tmdb_id) in wanted
    ]
    lflags = await flags_for(db, list({r.user_id for r in likes}))
    likes = [r for r in likes if lflags[r.user_id].share_likes and lflags[r.user_id].enabled]

    user_ids = {o.user_id for o in ops if o.parent_id is None} | {r.user_id for r in likes}
    people = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}

    out: list[s.FeedTitle] = []
    for key in dict.fromkeys(keys):
        mine = [o for o in ops if (o.media_type, o.tmdb_id) == key]
        liked = [r for r in likes if (r.media_type, r.tmdb_id) == key]
        if not mine and not liked:
            continue
        top = next((o for o in mine if o.parent_id is None), None)
        latest = None
        if top is not None:
            a = people.get(top.user_id)
            latest = s.Latest(
                id=top.id, body=top.body, created_at=top.created_at, season_number=top.season_number, episode_number=top.episode_number,
                author=None if top.is_anonymous or a is None else _person(a),
            )
        lp = [_person(people[r.user_id]) for r in liked[:PEOPLE_SHOWN] if r.user_id in people]
        out.append(
            s.FeedTitle(
                media_type=key[0], tmdb_id=key[1], latest=latest, comment_count=len(mine),
                likes=s.LikeSummary(count=len(liked), people=lp, more=max(0, len(liked) - PEOPLE_SHOWN)),
            )
        )

    out = await content_rating_service.filter_items(user, out)
    if with_titles:
        infos = await asyncio.gather(*(_title_info(t.media_type, t.tmdb_id) for t in out))
        kept = []
        for t, info in zip(out, infos):
            if info is None:
                continue
            t.title, t.poster_path, t.backdrop_path = info
            kept.append(t)
        out = kept
    return out


async def _home_on(db: AsyncSession, user: User) -> bool:
    on, config, flags = await _on(db, user)
    return on and config.home_section and flags.show_on_home


async def feed(db: AsyncSession, user: User) -> s.Feed:
    """The home row: the titles other people commented on or liked lately, newest activity first, one card each."""
    if not await _home_on(db, user):
        return s.Feed(enabled=False)
    since = datetime.now(timezone.utc) - timedelta(days=FEED_DAYS)
    activity: dict[tuple[str, int], datetime] = {}
    for m, i, at in (
        await db.execute(
            select(Opinion.media_type, Opinion.tmdb_id, func.max(Opinion.created_at))
            .where(Opinion.is_hidden.is_(False), Opinion.user_id != user.id, Opinion.created_at >= since)
            .group_by(Opinion.media_type, Opinion.tmdb_id)
        )
    ).all():
        activity[(m, i)] = at
    for m, i, at in (
        await db.execute(
            select(TitleLike.media_type, TitleLike.tmdb_id, func.max(TitleLike.created_at))
            .where(TitleLike.user_id != user.id, TitleLike.created_at >= since, TitleLike.season_number == WHOLE, TitleLike.episode_number == WHOLE)
            .group_by(TitleLike.media_type, TitleLike.tmdb_id)
        )
    ).all():
        activity[(m, i)] = max(at, activity.get((m, i), at))
    keys = [k for k, _ in sorted(activity.items(), key=lambda kv: kv[1], reverse=True)][: FEED_TITLES * 2]
    items = await summaries(db, user, keys)
    return s.Feed(enabled=True, items=items[:FEED_TITLES])


async def banner_social(db: AsyncSession, user: User, keys: list[tuple[str, int]]) -> s.Feed:
    """The same cards for the titles in the home banner (no title lookups: the banner already knows them)."""
    if not await _home_on(db, user):
        return s.Feed(enabled=False)
    return s.Feed(enabled=True, items=await summaries(db, user, keys[:10], with_titles=False))


# ---------------------------------------------------------------- admin


async def admin_list(db: AsyncSession, offset: int, limit: int, only_hidden: bool = False) -> s.AdminOpinionPage:
    where = [Opinion.is_hidden.is_(True)] if only_hidden else []
    total = await db.scalar(select(func.count()).select_from(Opinion).where(*where)) or 0
    rows = (await db.execute(select(Opinion, User).join(User, User.id == Opinion.user_id).where(*where).order_by(Opinion.created_at.desc()).offset(offset).limit(limit))).all()
    counts = {}
    if rows:
        counts = dict((await db.execute(select(OpinionLike.opinion_id, func.count()).where(OpinionLike.opinion_id.in_([o.id for o, _ in rows])).group_by(OpinionLike.opinion_id))).all())
    infos = await asyncio.gather(*(_title_info(o.media_type, o.tmdb_id) for o, _ in rows))
    items = [
        s.AdminOpinion(
            id=o.id, body=o.body, created_at=o.created_at, author_id=u.id, author_name=u.display_name, is_anonymous=o.is_anonymous,
            hidden=o.is_hidden, is_reply=o.parent_id is not None, media_type=o.media_type, tmdb_id=o.tmdb_id,
            season_number=o.season_number, episode_number=o.episode_number, title=info[0] if info else None, likes=counts.get(o.id, 0),
        )
        for (o, u), info in zip(rows, infos)
    ]
    return s.AdminOpinionPage(items=items, total=int(total))


async def admin_set_hidden(db: AsyncSession, opinion_id: uuid.UUID, hidden: bool) -> None:
    res = await db.execute(update(Opinion).where(Opinion.id == opinion_id).values(is_hidden=hidden))
    if res.rowcount == 0:
        raise HTTPException(404, "No such opinion.")
    await db.commit()
