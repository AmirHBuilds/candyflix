"""
Integration tests for /api/watchlist — real app, real Postgres/Redis
(same approach as test_playback_routes.py), TMDB mocked via respx for
the enrichment step.
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
from app.services import auth_service

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
    return client


async def _cleanup_user(db, username: str):
    user = await auth_service.get_user_by_username(db, username)
    if user is not None:
        await db.delete(user)
        await db.commit()


class TestAuth:
    async def test_get_requires_auth(self, client):
        assert (await client.get("/api/watchlist")).status_code == 401

    async def test_post_requires_auth(self, client):
        resp = await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})
        assert resp.status_code == 401

    async def test_delete_requires_auth(self, client):
        assert (await client.delete("/api/watchlist/movie/603")).status_code == 401

    async def test_status_requires_auth(self, client):
        resp = await client.get("/api/watchlist/status", params={"media_type": "movie", "tmdb_id": 603})
        assert resp.status_code == 401


class TestAddRemoveStatus:
    async def test_full_lifecycle(self, client, db):
        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)

            # Not on the list yet.
            status = await client.get(
                "/api/watchlist/status", params={"media_type": "movie", "tmdb_id": 603}
            )
            assert status.json()["in_watchlist"] is False

            # Add it.
            add_resp = await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})
            assert add_resp.status_code == 204

            status = await client.get(
                "/api/watchlist/status", params={"media_type": "movie", "tmdb_id": 603}
            )
            assert status.json()["in_watchlist"] is True

            # Adding again is a no-op, not an error.
            add_again = await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})
            assert add_again.status_code == 204

            # Remove it.
            remove_resp = await client.delete("/api/watchlist/movie/603")
            assert remove_resp.status_code == 204

            status = await client.get(
                "/api/watchlist/status", params={"media_type": "movie", "tmdb_id": 603}
            )
            assert status.json()["in_watchlist"] is False

            # Removing again is also a no-op.
            remove_again = await client.delete("/api/watchlist/movie/603")
            assert remove_again.status_code == 204
        finally:
            await _cleanup_user(db, username)

    async def test_movie_and_tv_with_same_tmdb_id_are_independent(self, client, db):
        """A movie and a TV show can coincidentally share a numeric TMDB
        id — media_type is part of the identity, not just tmdb_id."""
        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})

            tv_status = await client.get(
                "/api/watchlist/status", params={"media_type": "tv", "tmdb_id": 603}
            )
            assert tv_status.json()["in_watchlist"] is False
        finally:
            await _cleanup_user(db, username)

    async def test_status_rejects_bad_media_type(self, client, db):
        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/watchlist/status", params={"media_type": "album", "tmdb_id": 603}
            )
            assert resp.status_code == 400
        finally:
            await _cleanup_user(db, username)


class TestListEnrichment:
    @respx.mock
    async def test_list_is_enriched_with_tmdb_data_most_recent_first(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_603)
        )
        respx.get("https://api.themoviedb.org/3/tv/1396").mock(
            return_value=httpx.Response(200, json=TV_1396)
        )

        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})
            await client.post("/api/watchlist", json={"media_type": "tv", "tmdb_id": 1396})

            resp = await client.get("/api/watchlist")
            assert resp.status_code == 200
            body = resp.json()
            assert len(body) == 2
            # Most recently added first.
            assert body[0]["media_type"] == "tv"
            assert body[0]["title"] == "Breaking Bad"
            assert body[0]["poster_path"] == "/bb.jpg"
            assert body[1]["title"] == "The Matrix"
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_unresolvable_tmdb_item_is_skipped_not_a_500(self, client, db):
        """A title TMDB can no longer resolve (deleted, bad id, whatever)
        must not take the whole list down with it."""
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_603)
        )
        respx.get("https://api.themoviedb.org/3/movie/999999999").mock(
            return_value=httpx.Response(404, json={"status_message": "not found"})
        )

        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 999999999})
            await client.post("/api/watchlist", json={"media_type": "movie", "tmdb_id": 603})

            resp = await client.get("/api/watchlist")
            assert resp.status_code == 200
            body = resp.json()
            assert len(body) == 1
            assert body[0]["tmdb_id"] == 603
        finally:
            await _cleanup_user(db, username)

    async def test_empty_watchlist_returns_empty_list(self, client, db):
        username = f"wl_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/watchlist")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            await _cleanup_user(db, username)
