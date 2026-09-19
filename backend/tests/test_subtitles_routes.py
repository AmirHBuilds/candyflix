"""
Integration tests for /api/subtitles/search and /api/subtitles/download.

Same "real app, real Postgres/Redis, mocked third party" approach as
test_playback_routes.py / test_tmdb_service.py — both TMDB (for the
IMDb id lookup) and OpenSubtitles are mocked via respx.
"""
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.core.config import get_settings
from app.main import app
from app.services import auth_service

pytestmark = pytest.mark.asyncio

settings = get_settings()

MOVIE_WITH_IMDB = {"id": 603, "imdb_id": "tt0133093", "title": "The Matrix"}
TV_EXTERNAL_IDS = {"imdb_id": "tt0903747"}

SEARCH_RESPONSE = {
    "data": [
        {
            "attributes": {
                "language": "en",
                "release": "The.Matrix.1999.WEBRip",
                "download_count": 9000,
                "ratings": 9.0,
                "hearing_impaired": False,
                "files": [{"file_id": 42}],
            }
        }
    ]
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


@pytest.fixture(autouse=True)
def require_os_api_key(monkeypatch):
    monkeypatch.setattr(settings, "opensubtitles_api_key", "test-os-key")
    monkeypatch.setattr(settings, "opensubtitles_username", "")
    monkeypatch.setattr(settings, "opensubtitles_password", "")


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


class TestSearchRoute:
    async def test_requires_auth(self, client):
        resp = await client.get("/api/subtitles/search", params={"media_type": "movie", "tmdb_id": 603})
        assert resp.status_code == 401

    async def test_rejects_bad_media_type(self, client, db):
        username = f"sub_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/subtitles/search", params={"media_type": "album", "tmdb_id": 603}
            )
            assert resp.status_code == 400
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_movie_search_resolves_imdb_id_and_returns_results(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json=MOVIE_WITH_IMDB)
        )
        search_route = respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(200, json=SEARCH_RESPONSE)
        )

        username = f"sub_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/subtitles/search", params={"media_type": "movie", "tmdb_id": 603}
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["results"][0]["file_id"] == 42
            assert body["results"][0]["label"] == "English"
            # imdb_id resolved from TMDB and passed through, "tt" stripped.
            assert search_route.calls[0].request.url.params["imdb_id"] == "133093"
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_tv_search_uses_external_ids_endpoint(self, client, db):
        respx.get("https://api.themoviedb.org/3/tv/1396/external_ids").mock(
            return_value=httpx.Response(200, json=TV_EXTERNAL_IDS)
        )
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(200, json=SEARCH_RESPONSE)
        )

        username = f"sub_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/subtitles/search",
                params={"media_type": "tv", "tmdb_id": 1396, "season_number": 1, "episode_number": 1},
            )
            assert resp.status_code == 200
            assert resp.json()["results"][0]["file_id"] == 42
        finally:
            await _cleanup_user(db, username)

    @respx.mock
    async def test_no_imdb_id_returns_404(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(200, json={"id": 603, "title": "No IMDb link"})
        )

        username = f"sub_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/subtitles/search", params={"media_type": "movie", "tmdb_id": 603}
            )
            assert resp.status_code == 404
        finally:
            await _cleanup_user(db, username)


class TestDownloadRoute:
    @respx.mock
    async def test_download_returns_playable_subtitle_track(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "subtitle_cache_dir", str(tmp_path))
        respx.post("https://api.opensubtitles.com/api/v1/download").mock(
            return_value=httpx.Response(200, json={"link": "https://dl.example.com/sub.srt"})
        )
        respx.get("https://dl.example.com/sub.srt").mock(
            return_value=httpx.Response(200, text="1\n00:00:01,000 --> 00:00:02,000\nHi\n")
        )

        username = f"sub_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.post(
                "/api/subtitles/download",
                json={
                    "media_type": "movie",
                    "tmdb_id": 603,
                    "file_id": 42,
                    "language": "en",
                    "label": "English",
                },
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["format"] == "srt"
            assert body["language"] == "en"
            assert body["url"] == "/subtitle-cache/movie-603-en-42.srt"
            assert (tmp_path / "movie-603-en-42.srt").exists()
        finally:
            await _cleanup_user(db, username)

    async def test_download_requires_auth(self, client):
        resp = await client.post(
            "/api/subtitles/download",
            json={"media_type": "movie", "tmdb_id": 603, "file_id": 42, "language": "en", "label": "English"},
        )
        assert resp.status_code == 401
