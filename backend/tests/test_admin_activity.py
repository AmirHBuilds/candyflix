"""Phase 10a: presence heartbeat, 'watching now', a person's history and list (admin-only)."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.watch_progress import NO_EPISODE, NO_SEASON
from app.services import admin_service, auth_service, presence_service, tmdb_service, watch_progress_service, watchlist_service
from app.schemas.media import MovieDetail, TVShowDetail

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis_module.get_redis()
    yield
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
def fake_tmdb(monkeypatch):
    async def movie(tmdb_id):
        return MovieDetail(tmdb_id=tmdb_id, title=f"Movie {tmdb_id}", overview="", poster_path="/m.jpg")

    async def tv(tmdb_id):
        if tmdb_id == 404:
            raise tmdb_service.TMDBError(404, "gone")
        return TVShowDetail(tmdb_id=tmdb_id, title=f"Show {tmdb_id}", overview="", poster_path="/s.jpg", seasons=[])

    monkeypatch.setattr(tmdb_service, "get_movie", movie)
    monkeypatch.setattr(tmdb_service, "get_tv", tv)


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _n(p):
    return f"{p}_{uuid.uuid4().hex[:8]}"


async def _make(db, is_admin=False):
    name = _n("act")
    user = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin)
    token = await auth_service.create_session(user.id)
    return user, name, token


async def _cleanup(db, *names):
    await db.rollback()
    for n in names:
        u = await auth_service.get_user_by_username(db, n)
        if u:
            await presence_service.stop(u.id)
            await db.delete(u)
    await db.commit()


def as_(client, token):
    client.cookies.set(SESSION_COOKIE_NAME, token)


BEAT = {"tmdb_id": 1396, "media_type": "tv", "season_number": 2, "episode_number": 5, "position_seconds": 120.5, "duration_seconds": 2700, "playing": True}


class TestHeartbeat:
    async def test_requires_login(self, client):
        assert (await client.post("/api/presence", json=BEAT)).status_code == 401
        assert (await client.post("/api/presence/stop")).status_code == 401

    async def test_validates(self, client, db):
        user, name, token = await _make(db)
        try:
            as_(client, token)
            assert (await client.post("/api/presence", json={**BEAT, "season_number": None})).status_code == 422
            assert (await client.post("/api/presence", json={**BEAT, "media_type": "book"})).status_code == 422
            assert (await client.post("/api/presence", json={**BEAT, "position_seconds": -1})).status_code == 422
        finally:
            await _cleanup(db, name)

    async def test_beat_is_short_lived_keeps_since_and_stop_clears(self, client, db):
        user, name, token = await _make(db)
        try:
            as_(client, token)
            assert (await client.post("/api/presence", json=BEAT)).status_code == 204
            first = await presence_service.get_now(user.id)
            ttl = await redis_module.get_redis().ttl(f"presence:{user.id}")
            assert 0 < ttl <= presence_service.TTL_SECONDS
            await client.post("/api/presence", json={**BEAT, "position_seconds": 135.5, "playing": False})
            second = await presence_service.get_now(user.id)
            assert second["since"] == first["since"] and second["position_seconds"] == 135.5 and second["playing"] is False
            await client.post("/api/presence", json={**BEAT, "episode_number": 6})  # a new episode: a new "since"
            assert (await presence_service.get_now(user.id))["since"] >= second["since"]
            await client.post("/api/presence/stop")
            assert await presence_service.get_now(user.id) is None
        finally:
            await _cleanup(db, name)

    async def test_a_movie_ignores_season_and_episode(self, client, db):
        user, name, token = await _make(db)
        try:
            as_(client, token)
            await client.post("/api/presence", json={**BEAT, "media_type": "movie", "tmdb_id": 603})
            now = await presence_service.get_now(user.id)
            assert now["season_number"] is None and now["episode_number"] is None
        finally:
            await _cleanup(db, name)


class TestWatchingNow:
    async def test_admin_sees_who_is_watching_what(self, client, db):
        admin, a_name, a_token = await _make(db, is_admin=True)
        viewer, v_name, v_token = await _make(db)
        try:
            as_(client, v_token)
            await client.post("/api/presence", json=BEAT)
            as_(client, a_token)
            rows = [r for r in (await client.get("/api/admin/now-watching")).json() if r["user_id"] == str(viewer.id)]
            assert len(rows) == 1
            r = rows[0]
            assert (r["title"], r["season_number"], r["episode_number"], r["playing"]) == ("Show 1396", 2, 5, True)
            assert r["display_name"] == v_name.title() and r["position_seconds"] == 120.5
        finally:
            await _cleanup(db, a_name, v_name)

    async def test_titles_tmdb_cannot_find_are_still_listed(self, client, db):
        admin, a_name, a_token = await _make(db, is_admin=True)
        viewer, v_name, v_token = await _make(db)
        try:
            as_(client, v_token)
            await client.post("/api/presence", json={**BEAT, "tmdb_id": 404})
            as_(client, a_token)
            rows = [r for r in (await client.get("/api/admin/now-watching")).json() if r["user_id"] == str(viewer.id)]
            assert rows and rows[0]["title"] is None
        finally:
            await _cleanup(db, a_name, v_name)

    async def test_a_disabled_person_is_not_listed(self, db):
        user, name, _ = await _make(db)
        try:
            await presence_service.beat(user.id, tmdb_id=1, media_type="movie", season_number=None, episode_number=None,
                                        position_seconds=1, duration_seconds=2, playing=True)
            assert any(n.user_id == user.id for n in await admin_service.now_watching(db))
            user.is_disabled = True
            await db.commit()
            assert not any(n.user_id == user.id for n in await admin_service.now_watching(db))
        finally:
            await _cleanup(db, name)


class TestPersonPage:
    async def test_detail_history_and_list(self, client, db):
        admin, a_name, a_token = await _make(db, is_admin=True)
        viewer, v_name, v_token = await _make(db)
        try:
            await watch_progress_service.save_progress(db, viewer.id, 603, "movie", None, None, 600.0, 7200.0)
            await watch_progress_service.save_progress(db, viewer.id, 1396, "tv", 2, 5, 2700.0, 2700.0)
            await watch_progress_service.mark_episode_visited(db, viewer.id, 1396, 2, 6)
            await watchlist_service.add_item(db, viewer.id, 27205, "movie")
            as_(client, v_token)
            await client.post("/api/presence", json=BEAT)
            as_(client, a_token)

            detail = (await client.get(f"/api/admin/users/{viewer.id}/detail")).json()
            assert detail["user"]["username"] == v_name and detail["active_sessions"] == 1
            assert detail["now_watching"]["title"] == "Show 1396" and detail["last_activity"]

            hist = (await client.get(f"/api/admin/users/{viewer.id}/history")).json()
            assert hist["total"] == 3 and len(hist["items"]) == 3
            by = {(i["media_type"], i["season_number"], i["episode_number"]): i for i in hist["items"]}
            movie = by[("movie", None, None)]
            assert movie["title"] == "Movie 603" and round(movie["fraction"], 3) == round(600 / 7200, 3) and not movie["opened_only"]
            assert by[("tv", 2, 5)]["fraction"] == 1.0
            opened = by[("tv", 2, 6)]
            assert opened["opened_only"] is True and opened["fraction"] is None
            assert [i["updated_at"] for i in hist["items"]] == sorted((i["updated_at"] for i in hist["items"]), reverse=True)

            page = (await client.get(f"/api/admin/users/{viewer.id}/history", params={"limit": 2, "offset": 2})).json()
            assert page["total"] == 3 and len(page["items"]) == 1

            wl = (await client.get(f"/api/admin/users/{viewer.id}/watchlist")).json()
            assert [(w["tmdb_id"], w["title"]) for w in wl] == [(27205, "Movie 27205")]
        finally:
            await _cleanup(db, a_name, v_name)

    async def test_unknown_person_is_404_and_limits_are_validated(self, client, db):
        admin, a_name, a_token = await _make(db, is_admin=True)
        try:
            as_(client, a_token)
            ghost = uuid.uuid4()
            for path in ("detail", "history", "watchlist"):
                assert (await client.get(f"/api/admin/users/{ghost}/{path}")).status_code == 404
            assert (await client.get(f"/api/admin/users/{admin.id}/history", params={"limit": 0})).status_code == 422
            assert (await client.get(f"/api/admin/users/{admin.id}/history", params={"limit": 500})).status_code == 422
        finally:
            await _cleanup(db, a_name)

    async def test_a_regular_person_cannot_read_anyone_elses(self, client, db):
        a, a_name, a_token = await _make(db)
        b, b_name, _ = await _make(db)
        try:
            as_(client, a_token)
            for path in ("detail", "history", "watchlist"):
                assert (await client.get(f"/api/admin/users/{b.id}/{path}")).status_code == 403
            assert (await client.get("/api/admin/now-watching")).status_code == 403
        finally:
            await _cleanup(db, a_name, b_name)
