"""Opinions, replies, anonymous posting, likes, the home feed and the switches around them."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.user_settings import UserSettings as UserSettingsRow
from app.schemas.media import MovieDetail
from app.schemas.site import SocialConfig
from sqlalchemy import delete

from app.models.opinion import Opinion, TitleLike
from app.services import auth_service, site_service, tmdb_service

pytestmark = pytest.mark.asyncio

CERTS = {("movie", 1): "G", ("movie", 4): "R"}


@pytest.fixture(autouse=True)
async def env(monkeypatch):
    redis_module._redis_client = None
    redis_module.get_redis()

    async def cert(kind, i):
        return CERTS.get((kind, i), "G")

    async def adult(kind, i):
        return False

    async def movie(i):
        return MovieDetail(tmdb_id=i, title=f"Movie {i}", overview="x", poster_path=f"/p{i}.jpg")

    monkeypatch.setattr(tmdb_service, "get_certification", cert)
    monkeypatch.setattr(tmdb_service, "is_adult_flagged", adult)
    monkeypatch.setattr(tmdb_service, "get_movie", movie)
    async def clean():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Opinion))
            await db.execute(delete(TitleLike))
            await db.commit()
            await site_service.set_social_config(db, SocialConfig())

    await clean()
    yield
    await clean()
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None
    await engine.dispose()


async def make(is_admin=False, limit=None, social=None, blocked=False):
    name = f"op_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        u = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin, age_limit=limit)
        if blocked:
            u.opinions_blocked = True
        if social:
            db.add(UserSettingsRow(user_id=u.id, data={"social": social}))
        await db.commit()
        return u.id


async def client_for(uid):
    ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    ac.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))
    return ac


def body(text="Loved it", tmdb_id=1, **kw):
    return {"media_type": "movie", "tmdb_id": tmdb_id, "body": text, **kw}


Q = {"media_type": "movie", "tmdb_id": 1}


async def test_post_read_and_delete_own_opinion():
    a = await client_for(await make())
    r = await a.post("/api/opinions", json=body("Amazing, watch it!"))
    assert r.status_code == 201 and r.json()["mine"] is True
    got = (await a.get("/api/opinions/title", params=Q)).json()
    assert got["enabled"] and got["can_comment"]
    assert [o["body"] for o in got["opinions"]] == ["Amazing, watch it!"]
    assert (await a.delete(f"/api/opinions/{r.json()['id']}")).status_code == 204
    assert (await a.get("/api/opinions/title", params=Q)).json()["opinions"] == []
    await a.aclose()


async def test_others_see_it_but_cannot_delete_it():
    a, b = await client_for(await make()), await client_for(await make())
    oid = (await a.post("/api/opinions", json=body())).json()["id"]
    seen = (await b.get("/api/opinions/title", params=Q)).json()["opinions"][0]
    assert seen["mine"] is False and seen["author"]["name"]
    assert (await b.delete(f"/api/opinions/{oid}")).status_code == 403
    await a.aclose(); await b.aclose()


async def test_anonymous_hides_the_author_from_people_but_not_admins():
    author = await make()
    a, other, admin = await client_for(author), await client_for(await make()), await client_for(await make(is_admin=True))
    await a.post("/api/opinions", json=body(anonymous=True))
    seen = (await other.get("/api/opinions/title", params=Q)).json()["opinions"][0]
    assert seen["author"] is None and seen["is_anonymous"] and seen["real_author"] is None
    assert (await a.get("/api/opinions/title", params=Q)).json()["opinions"][0]["mine"] is True
    real = (await admin.get("/api/opinions/title", params=Q)).json()["opinions"][0]
    assert real["real_author"]
    for c in (a, other, admin):
        await c.aclose()


async def test_anonymous_can_be_switched_off_for_everyone():
    async with AsyncSessionLocal() as db:
        await site_service.set_social_config(db, SocialConfig(allow_anonymous=False))
    a = await client_for(await make())
    assert (await a.post("/api/opinions", json=body(anonymous=True))).status_code == 400
    assert (await a.post("/api/opinions", json=body())).status_code == 201
    await a.aclose()


async def test_replies_are_one_level_deep_and_listed_under_their_parent():
    a, b = await client_for(await make()), await client_for(await make())
    top = (await a.post("/api/opinions", json=body("Great"))).json()["id"]
    reply = await b.post("/api/opinions", json=body("Agreed", parent_id=top))
    assert reply.status_code == 201
    assert (await a.post("/api/opinions", json=body("nested", parent_id=reply.json()["id"]))).status_code == 404
    got = (await a.get("/api/opinions/title", params=Q)).json()["opinions"]
    assert len(got) == 1 and [r["body"] for r in got[0]["replies"]] == ["Agreed"]
    await a.aclose(); await b.aclose()


async def test_a_reply_must_belong_to_the_same_title():
    a = await client_for(await make())
    top = (await a.post("/api/opinions", json=body("Great", tmdb_id=1))).json()["id"]
    assert (await a.post("/api/opinions", json=body("x", tmdb_id=2, parent_id=top))).status_code == 404
    await a.aclose()


async def test_replies_can_be_switched_off():
    async with AsyncSessionLocal() as db:
        await site_service.set_social_config(db, SocialConfig(allow_replies=False))
    a = await client_for(await make())
    top = (await a.post("/api/opinions", json=body())).json()["id"]
    assert (await a.post("/api/opinions", json=body("re", parent_id=top))).status_code == 400
    await a.aclose()


async def test_empty_and_too_long_are_refused():
    a = await client_for(await make())
    assert (await a.post("/api/opinions", json=body("   "))).status_code == 422
    assert (await a.post("/api/opinions", json=body("x" * 501))).status_code == 422
    await a.aclose()


async def test_posting_is_rate_limited():
    a = await client_for(await make())
    codes = [(await a.post("/api/opinions", json=body(f"n{i}"))).status_code for i in range(22)]
    assert codes[:20] == [201] * 20 and codes[20] == 429
    await a.aclose()


async def test_comment_likes_toggle_and_count():
    a, b = await client_for(await make()), await client_for(await make())
    oid = (await a.post("/api/opinions", json=body())).json()["id"]
    assert (await b.put(f"/api/opinions/{oid}/like", params={"liked": True})).json() == {"likes": 1, "liked_by_me": True}
    assert (await b.put(f"/api/opinions/{oid}/like", params={"liked": True})).json()["likes"] == 1
    assert (await a.put(f"/api/opinions/{oid}/like", params={"liked": True})).json()["likes"] == 2
    assert (await b.put(f"/api/opinions/{oid}/like", params={"liked": False})).json() == {"likes": 1, "liked_by_me": False}
    await a.aclose(); await b.aclose()


async def test_title_likes_show_who_liked_and_how_many_more():
    me = await client_for(await make())
    others = [await client_for(await make()) for _ in range(5)]
    for o in others:
        r = await o.put("/api/opinions/likes/title", json={**Q, "liked": True})
        assert r.status_code == 200
    got = (await me.get("/api/opinions/title", params=Q)).json()["likes"]
    assert got["count"] == 5 and got["you_liked"] is False and len(got["people"]) == 3 and got["more"] == 2
    r = await me.put("/api/opinions/likes/title", json={**Q, "liked": True})
    assert r.json()["likes"]["count"] == 6 and r.json()["likes"]["you_liked"] is True
    r = await me.put("/api/opinions/likes/title", json={**Q, "liked": False})
    assert r.json()["likes"]["count"] == 5
    for c in [me, *others]:
        await c.aclose()


async def test_private_likes_are_not_shown_or_counted_for_others():
    quiet = await client_for(await make(social={"share_likes": False}))
    viewer = await client_for(await make())
    await quiet.put("/api/opinions/likes/title", json={**Q, "liked": True})
    assert (await quiet.get("/api/opinions/title", params=Q)).json()["likes"]["you_liked"] is True
    seen = (await viewer.get("/api/opinions/title", params=Q)).json()["likes"]
    assert seen["count"] == 0 and seen["people"] == []
    await quiet.aclose(); await viewer.aclose()


async def test_episode_scope_is_separate_from_the_title():
    a = await client_for(await make())
    ep = {"media_type": "tv", "tmdb_id": 1, "season_number": 1, "episode_number": 2}
    await a.post("/api/opinions", json={**ep, "body": "This episode!"})
    await a.post("/api/opinions", json=body("whole movie"))
    assert [o["body"] for o in (await a.get("/api/opinions/title", params=ep)).json()["opinions"]] == ["This episode!"]
    assert (await a.get("/api/opinions/title", params={"media_type": "tv", "tmdb_id": 1})).json()["opinions"] == []
    bad = {"media_type": "tv", "tmdb_id": 1, "episode_number": 2, "body": "x"}
    assert (await a.post("/api/opinions", json=bad)).status_code == 422
    await a.aclose()


async def test_turning_it_off_in_my_settings_hides_everything_for_me_only():
    off = await client_for(await make(social={"enabled": False}))
    on = await client_for(await make())
    await on.post("/api/opinions", json=body())
    assert (await off.get("/api/opinions/title", params=Q)).json() == {**(await off.get("/api/opinions/title", params=Q)).json(), "enabled": False, "opinions": []}
    assert (await off.post("/api/opinions", json=body())).status_code == 403
    assert (await off.get("/api/opinions/feed")).json()["enabled"] is False
    assert len((await on.get("/api/opinions/title", params=Q)).json()["opinions"]) == 1
    await off.aclose(); await on.aclose()


async def test_admin_can_switch_the_whole_thing_off():
    async with AsyncSessionLocal() as db:
        await site_service.set_social_config(db, SocialConfig(enabled=False))
    a = await client_for(await make())
    assert (await a.get("/api/opinions/title", params=Q)).json()["enabled"] is False
    assert (await a.post("/api/opinions", json=body())).status_code == 403
    await a.aclose()


async def test_a_muted_person_can_read_but_not_write():
    m = await client_for(await make(blocked=True))
    got = (await m.get("/api/opinions/title", params=Q)).json()
    assert got["enabled"] and got["can_comment"] is False and got["why_not"]
    assert (await m.post("/api/opinions", json=body())).status_code == 403
    await m.aclose()


async def test_age_limit_applies_to_opinions():
    kid = await client_for(await make(limit="PG"))
    adult = await client_for(await make())
    await adult.post("/api/opinions", json=body("gritty", tmdb_id=4))
    await adult.post("/api/opinions", json=body("lovely", tmdb_id=1))
    assert (await kid.get("/api/opinions/title", params={"media_type": "movie", "tmdb_id": 4})).status_code == 403
    assert (await kid.post("/api/opinions", json=body(tmdb_id=4))).status_code == 403
    feed = (await kid.get("/api/opinions/feed")).json()
    assert {o["tmdb_id"] for o in feed["opinions"]} == {1}
    await kid.aclose(); await adult.aclose()


async def test_feed_shows_others_recent_opinions_and_likes_with_titles():
    me, other = await client_for(await make()), await client_for(await make())
    await other.post("/api/opinions", json=body("Please watch", tmdb_id=1))
    await other.put("/api/opinions/likes/title", json={"media_type": "movie", "tmdb_id": 1, "liked": True})
    await me.post("/api/opinions", json=body("mine", tmdb_id=1))
    feed = (await me.get("/api/opinions/feed")).json()
    assert feed["enabled"]
    assert [o["body"] for o in feed["opinions"]] == ["Please watch"]
    assert feed["opinions"][0]["title"] == "Movie 1" and feed["opinions"][0]["author"]["name"]
    assert feed["likes"][0]["title"] == "Movie 1" and len(feed["likes"][0]["people"]) == 1
    await me.aclose(); await other.aclose()


async def test_feed_hides_anonymous_authors_and_respects_the_home_switches():
    me = await client_for(await make())
    other = await client_for(await make())
    await other.post("/api/opinions", json=body("secret", anonymous=True))
    assert (await me.get("/api/opinions/feed")).json()["opinions"][0]["author"] is None
    nohome = await client_for(await make(social={"show_on_home": False}))
    assert (await nohome.get("/api/opinions/feed")).json()["enabled"] is False
    async with AsyncSessionLocal() as db:
        await site_service.set_social_config(db, SocialConfig(home_section=False))
    assert (await me.get("/api/opinions/feed")).json()["enabled"] is False
    for c in (me, other, nohome):
        await c.aclose()


async def test_admin_can_hide_unhide_and_delete_and_sees_hidden_ones():
    a, other, admin = await client_for(await make()), await client_for(await make()), await client_for(await make(is_admin=True))
    oid = (await a.post("/api/opinions", json=body("rude", anonymous=True))).json()["id"]
    listing = (await admin.get("/api/admin/opinions")).json()
    row = next(i for i in listing["items"] if i["id"] == oid)
    assert row["author_name"] and row["is_anonymous"] and row["title"] == "Movie 1"
    assert (await admin.post(f"/api/admin/opinions/{oid}/hide")).status_code == 204
    assert (await other.get("/api/opinions/title", params=Q)).json()["opinions"] == []
    assert (await other.get("/api/opinions/feed")).json()["opinions"] == []
    assert (await other.put(f"/api/opinions/{oid}/like", params={"liked": True})).status_code == 404
    mine = (await admin.get("/api/opinions/title", params=Q)).json()["opinions"][0]
    assert mine["hidden"] is True
    assert any(i["id"] == oid for i in (await admin.get("/api/admin/opinions", params={"hidden": True})).json()["items"])
    assert (await admin.post(f"/api/admin/opinions/{oid}/unhide")).status_code == 204
    assert len((await other.get("/api/opinions/title", params=Q)).json()["opinions"]) == 1
    assert (await admin.delete(f"/api/admin/opinions/{oid}")).status_code == 204
    assert (await other.get("/api/opinions/title", params=Q)).json()["opinions"] == []
    assert (await other.get("/api/admin/opinions")).status_code == 403
    for c in (a, other, admin):
        await c.aclose()


async def test_admin_can_mute_a_user_and_change_the_site_switches():
    uid = await make()
    admin = await client_for(await make(is_admin=True))
    r = await admin.patch(f"/api/admin/users/{uid}", json={"opinions_blocked": True})
    assert r.status_code == 200 and r.json()["opinions_blocked"] is True
    r = await admin.patch(f"/api/admin/users/{uid}", json={"opinions_blocked": False})
    assert r.json()["opinions_blocked"] is False
    r = await admin.put("/api/admin/social", json={"enabled": True, "allow_anonymous": False, "allow_replies": True, "home_section": True})
    assert r.status_code == 200 and (await admin.get("/api/admin/social")).json()["allow_anonymous"] is False
    plain = await client_for(await make())
    assert (await plain.get("/api/admin/social")).status_code == 403
    await admin.aclose(); await plain.aclose()


async def test_everything_needs_a_session():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get("/api/opinions/feed")).status_code == 401
        assert (await anon.get("/api/opinions/title", params=Q)).status_code == 401
        assert (await anon.post("/api/opinions", json=body())).status_code == 401
