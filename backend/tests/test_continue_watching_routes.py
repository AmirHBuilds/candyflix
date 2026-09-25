"""
Integration tests for /api/continue-watching — real app, real
Postgres/Redis (same approach as test_watchlist_routes.py), TMDB mocked
via respx for the enrichment step.
"""
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service, watch_progress_service

pytestmark = pytest.mark.asyncio

MOVIE_603 = {
    "id": 603,
    "title": "The Matrix",
    "overview": "A hacker discovers reality is a simulation.",
    "release_date": "1999-03-30",
    "genres": [],
    "poster_path": "/matrix.jpg",
    "backdrop_path": "/matrix-bg.jpg",
    "vote_average": 8.7,
}

TV_1396 = {
    "id": 1396,
    "name": "Breaking Bad",
    "overview": "A teacher turns to crime.",
    "first_air_date": "2008-01-20",
    "genres": [],
    "poster_path": "/bb.jpg",
    "backdrop_path": "/bb-bg.jpg",
    "vote_average": 9.5,
    "seasons": [],
}


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    keys = await redis.keys("tmdb:*")
    if keys:
        await redis.delete(*keys)
    yield
    await redis.aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _make_authed_client(client: AsyncClient, db, username: str) -> AsyncClient:
    user = await auth_service.create_user(db, username, username.title(), "testpass123")
    token = await auth_service.create_session(user.id)
    client.cookies.set(SESSION_COOKIE_NAME, token)
    client._test_user = user  # stash for save_progress calls below
    return client


async def _cleanup_user(db, username: str):
    user = await auth_service.get_user_by_username(db, username)
    if user is not None:
        await db.delete(user)
        await db.commit()


class TestAuth:
    async def test_requires_auth(self, client):
        assert (await client.get("/api/continue-watching")).status_code == 401


class TestListing:
    async def test_empty_when_nothing_in_progress(self, client, db):
        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            assert resp.json() == {"items": [], "has_more": False}
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_movie_and_episode_both_returned_most_recent_first(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_603)
        )
        respx.get("https://api.themoviedb.org/3/tv/1396").mock(
            return_value=httpx.Response(200, json=TV_1396)
        )

        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user

            # Movie saved first (older updated_at)...
            await watch_progress_service.save_progress(
                db, user.id, 603, "movie", None, None, position_seconds=100.0, duration_seconds=8000.0
            )
            # ...then a TV episode saved second, so it should sort first.
            await watch_progress_service.save_progress(
                db, user.id, 1396, "tv", 2, 8, position_seconds=300.0, duration_seconds=2700.0
            )

            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            body = resp.json()["items"]
            assert len(body) == 2
            assert body[0]["media_type"] == "tv"
            assert body[0]["title"] == "Breaking Bad"
            assert body[0]["season_number"] == 2
            assert body[0]["episode_number"] == 8
            assert body[1]["media_type"] == "movie"
            assert body[1]["title"] == "The Matrix"
            assert body[1]["season_number"] is None
            assert body[1]["episode_number"] is None
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_series_collapses_to_most_recently_watched_episode(self, client, db):
        """Partial progress on several episodes of the same show must
        surface as ONE Continue Watching entry — the most recent one —
        not one row per episode ever partially watched."""
        respx.get("https://api.themoviedb.org/3/tv/1396").mock(
            return_value=httpx.Response(200, json=TV_1396)
        )

        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user

            await watch_progress_service.save_progress(
                db, user.id, 1396, "tv", 1, 1, position_seconds=200.0, duration_seconds=2700.0
            )
            await watch_progress_service.save_progress(
                db, user.id, 1396, "tv", 2, 8, position_seconds=300.0, duration_seconds=2700.0
            )

            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            body = resp.json()["items"]
            assert len(body) == 1
            assert body[0]["season_number"] == 2
            assert body[0]["episode_number"] == 8
        finally:
            await _cleanup_user(db, username)

    async def test_finished_title_is_excluded(self, client, db):
        """At/past NEAR_COMPLETE_FRACTION of duration, a title is done,
        not 'in progress' — it shouldn't show up here at all."""
        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user

            await watch_progress_service.save_progress(
                db, user.id, 603, "movie", None, None, position_seconds=7999.0, duration_seconds=8000.0
            )

            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            assert resp.json() == {"items": [], "has_more": False}
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_unresolvable_tmdb_item_is_skipped_not_a_500(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_603)
        )
        respx.get("https://api.themoviedb.org/3/movie/999999999").mock(
            return_value=httpx.Response(404, json={"status_message": "not found"})
        )

        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user

            await watch_progress_service.save_progress(
                db, user.id, 999999999, "movie", None, None, position_seconds=10.0, duration_seconds=8000.0
            )
            await watch_progress_service.save_progress(
                db, user.id, 603, "movie", None, None, position_seconds=10.0, duration_seconds=8000.0
            )

            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            body = resp.json()["items"]
            assert len(body) == 1
            assert body[0]["tmdb_id"] == 603
        finally:
            await _cleanup_user(db, username)

    async def test_only_current_users_progress_is_returned(self, client, db):
        username_a = f"cw_test_{uuid.uuid4().hex[:8]}"
        username_b = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            user_a = await auth_service.create_user(db, username_a, "A", "testpass123")
            await watch_progress_service.save_progress(
                db, user_a.id, 603, "movie", None, None, position_seconds=10.0, duration_seconds=8000.0
            )

            await _make_authed_client(client, db, username_b)
            resp = await client.get("/api/continue-watching")
            assert resp.status_code == 200
            assert resp.json() == {"items": [], "has_more": False}
        finally:
            await _cleanup_user(db, username_a)
            await _cleanup_user(db, username_b)


class TestLimitAndHasMore:
    """The home page's "Continue Watching" row (limit=24 default) and
    the "View All" page (a larger explicit limit) share this one
    endpoint — has_more is what tells the home page whether to show a
    View All link at all."""

    @respx.mock
    async def test_has_more_false_when_everything_fits(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_603)
        )
        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user
            await watch_progress_service.save_progress(
                db, user.id, 603, "movie", None, None, position_seconds=10.0, duration_seconds=8000.0
            )

            resp = await client.get("/api/continue-watching", params={"limit": 24})
            assert resp.status_code == 200
            body = resp.json()
            assert len(body["items"]) == 1
            assert body["has_more"] is False
        finally:
            await _cleanup_user(db, username)

    async def test_has_more_true_when_more_rows_exist_than_limit(self, client, db):
        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user
            # Three distinct movie ids won't resolve via TMDB (not
            # mocked here), which is fine — has_more is computed from
            # the raw DB row count fetched (limit+1), before enrichment
            # drops anything, so this doesn't need working TMDB mocks.
            for tmdb_id in (1, 2, 3):
                await watch_progress_service.save_progress(
                    db, user.id, tmdb_id, "movie", None, None,
                    position_seconds=10.0, duration_seconds=8000.0,
                )

            resp = await client.get("/api/continue-watching", params={"limit": 2})
            assert resp.status_code == 200
            assert resp.json()["has_more"] is True
        finally:
            await _cleanup_user(db, username)

    async def test_limit_is_respected(self, client, db):
        username = f"cw_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user
            for tmdb_id in (1, 2, 3):
                await watch_progress_service.save_progress(
                    db, user.id, tmdb_id, "movie", None, None,
                    position_seconds=10.0, duration_seconds=8000.0,
                )

            # None of these TMDB ids resolve (not mocked), so every raw
            # row gets filtered by enrichment — this only checks that
            # the raw fetch itself respects `limit` (via has_more),
            # independent of enrichment.
            resp = await client.get("/api/continue-watching", params={"limit": 1})
            assert resp.status_code == 200
            assert resp.json()["has_more"] is True
        finally:
            await _cleanup_user(db, username)
