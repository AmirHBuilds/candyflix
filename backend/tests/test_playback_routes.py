"""
Integration tests for /api/playback and /api/watch-progress.

These hit the real FastAPI app (via ASGI transport, no live network
socket) against real Postgres and real Redis — the same "genuinely
verified, not mocked" approach used for the TMDB caching tests. The
only thing faked is the mock video provider's filesystem, via a real
temp directory (see test_mock_provider.py for the provider's own
dedicated tests).
"""
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
import app.services.subtitle_service as subtitle_service
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.providers import mock_provider
from app.schemas.playback import SubtitleTrackOut
from app.services import auth_service, watch_progress_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clean_redis():
    """Resets the Redis client singleton per test (pytest-asyncio gives
    each test its own event loop; a connection from a previous test's
    loop can't be reused) — same pattern as test_tmdb_service.py."""
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    yield
    await redis.aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    """Same event-loop issue as Redis, but for the SQLAlchemy engine's
    connection pool: pooled asyncpg connections are bound to the loop
    that created them, so a connection opened in one test can't be
    reused by the next test's (different) loop. Disposing after each
    test forces fresh connections next time, under the new loop."""
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
def no_real_default_subtitle_lookup(monkeypatch):
    """The playback routes now call out to TMDB + OpenSubtitles to find a
    default English subtitle (Phase 5b) — real network access neither
    available in CI/sandboxes nor desirable for tests that don't care
    about subtitle content at all. Defaults to "found nothing" (which is
    also the real graceful-degradation behavior when those services are
    unreachable); the one test that actually cares about subtitle content
    overrides this directly."""
    monkeypatch.setattr(subtitle_service, "get_default_english_track", AsyncMock(return_value=None))


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
    client._test_user = user  # stash for assertions
    return client


@pytest.fixture
def mock_video_dirs(tmp_path, monkeypatch):
    videos = tmp_path / "mock-videos"
    videos.mkdir()
    settings = mock_provider.get_settings()
    monkeypatch.setattr(settings, "mock_videos_dir", str(videos))
    return videos


async def _cleanup_user(db, username: str):
    user = await auth_service.get_user_by_username(db, username)
    if user is not None:
        from sqlalchemy import delete

        from app.models.watch_progress import WatchProgress

        await db.execute(delete(WatchProgress).where(WatchProgress.user_id == user.id))
        await db.delete(user)
        await db.commit()


class TestPlaybackAuth:
    async def test_playback_requires_auth(self, client):
        resp = await client.get("/api/playback/movie/550")
        assert resp.status_code == 401


class TestPlaybackSource:
    async def test_no_mock_video_returns_404_with_clear_message(
        self, client, db, mock_video_dirs
    ):
        username = f"pb_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/playback/movie/550")
            assert resp.status_code == 404
            assert "mock-videos" in resp.json()["detail"]
        finally:
            await _cleanup_user(db, username)

    async def test_playback_source_includes_video_and_default_english_subtitle(
        self, client, db, mock_video_dirs, monkeypatch
    ):
        videos = mock_video_dirs
        (videos / "test.mp4").write_bytes(b"fake")
        monkeypatch.setattr(
            subtitle_service,
            "get_default_english_track",
            AsyncMock(
                return_value=SubtitleTrackOut(
                    language="en", label="English", url="/subtitle-cache/movie-550-en-1.srt", format="srt"
                )
            ),
        )

        username = f"pb_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/playback/movie/550")
            assert resp.status_code == 200
            body = resp.json()
            assert body["source_type"] == "mock"
            assert body["url"] == "/mock-videos/test.mp4"
            assert body["subtitles"] == [
                {"language": "en", "label": "English", "url": "/subtitle-cache/movie-550-en-1.srt", "format": "srt"}
            ]
            assert body["resume_position_seconds"] is None
        finally:
            await _cleanup_user(db, username)

    async def test_playback_source_has_no_subtitles_when_lookup_finds_none(
        self, client, db, mock_video_dirs
    ):
        """The autouse no_real_default_subtitle_lookup fixture already
        returns None here — this locks in that playback itself must never
        fail just because the (optional, best-effort) subtitle lookup did."""
        videos = mock_video_dirs
        (videos / "test.mp4").write_bytes(b"fake")

        username = f"pb_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/playback/movie/550")
            assert resp.status_code == 200
            assert resp.json()["subtitles"] == []
        finally:
            await _cleanup_user(db, username)

    async def test_playback_source_includes_resume_position_when_progress_exists(
        self, client, db, mock_video_dirs
    ):
        videos = mock_video_dirs
        (videos / "test.mp4").write_bytes(b"fake")

        username = f"pb_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            user = client._test_user
            await watch_progress_service.save_progress(
                db, user.id, 550, "movie", None, None, position_seconds=222.5, duration_seconds=8000.0
            )

            resp = await client.get("/api/playback/movie/550")
            assert resp.status_code == 200
            assert resp.json()["resume_position_seconds"] == 222.5
        finally:
            await _cleanup_user(db, username)


class TestWatchProgressAPI:
    async def test_save_then_get_round_trip(self, client, db):
        username = f"wp_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)

            save_resp = await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 550,
                    "media_type": "movie",
                    "position_seconds": 100.0,
                    "duration_seconds": 8000.0,
                },
            )
            assert save_resp.status_code == 200
            assert save_resp.json()["season_number"] is None

            get_resp = await client.get("/api/watch-progress/movie/550")
            assert get_resp.status_code == 200
            assert get_resp.json()["position_seconds"] == 100.0
        finally:
            await _cleanup_user(db, username)

    async def test_get_returns_null_when_no_progress_saved(self, client, db):
        username = f"wp_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/watch-progress/movie/999999")
            assert resp.status_code == 200
            assert resp.json() is None
        finally:
            await _cleanup_user(db, username)

    async def test_second_save_updates_rather_than_duplicates(self, client, db):
        username = f"wp_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)

            for pos in (50.0, 4000.0):
                resp = await client.post(
                    "/api/watch-progress",
                    json={
                        "tmdb_id": 550,
                        "media_type": "movie",
                        "position_seconds": pos,
                        "duration_seconds": 8000.0,
                    },
                )
                assert resp.status_code == 200

            get_resp = await client.get("/api/watch-progress/movie/550")
            assert get_resp.json()["position_seconds"] == 4000.0
        finally:
            await _cleanup_user(db, username)

    async def test_episode_progress_is_independent_of_movie_progress(self, client, db):
        username = f"wp_test_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)

            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 1,
                    "position_seconds": 300.0,
                    "duration_seconds": 3000.0,
                },
            )
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 2,
                    "position_seconds": 600.0,
                    "duration_seconds": 3000.0,
                },
            )

            ep1 = await client.get("/api/watch-progress/tv/1399/1/1")
            ep2 = await client.get("/api/watch-progress/tv/1399/1/2")
            assert ep1.json()["position_seconds"] == 300.0
            assert ep2.json()["position_seconds"] == 600.0
        finally:
            await _cleanup_user(db, username)

    async def test_progress_is_isolated_per_user(self, client, db):
        """The whole point of per-user progress: Candy's position on a
        title must never be visible to Mom or Sister."""
        username_a = f"wp_iso_a_{uuid.uuid4().hex[:8]}"
        username_b = f"wp_iso_b_{uuid.uuid4().hex[:8]}"
        try:
            client_a = await _make_authed_client(client, db, username_a)
            await client_a.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 550,
                    "media_type": "movie",
                    "position_seconds": 4321.0,
                    "duration_seconds": 8000.0,
                },
            )

            transport_b = ASGITransport(app=app)
            async with AsyncClient(transport=transport_b, base_url="http://test") as client_b:
                await _make_authed_client(client_b, db, username_b)
                resp_b = await client_b.get("/api/watch-progress/movie/550")
                assert resp_b.json() is None, "user B must not see user A's progress"
        finally:
            await _cleanup_user(db, username_a)
            await _cleanup_user(db, username_b)

    async def test_watch_progress_requires_auth(self, client):
        resp = await client.get("/api/watch-progress/movie/550")
        assert resp.status_code == 401


class TestLatestWatchProgress:
    """GET /watch-progress/tv/{tmdb_id}/latest — backs the TV detail
    page's Watch Now button."""

    async def test_null_when_show_never_started(self, client, db):
        username = f"wp_latest_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get("/api/watch-progress/tv/1399/latest")
            assert resp.status_code == 200
            assert resp.json() is None
        finally:
            await _cleanup_user(db, username)

    async def test_returns_most_recently_updated_episode(self, client, db):
        username = f"wp_latest_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 1,
                    "position_seconds": 300.0,
                    "duration_seconds": 3000.0,
                },
            )
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 2,
                    "episode_number": 8,
                    "position_seconds": 50.0,
                    "duration_seconds": 3000.0,
                },
            )

            resp = await client.get("/api/watch-progress/tv/1399/latest")
            assert resp.status_code == 200
            body = resp.json()
            assert body["season_number"] == 2
            assert body["episode_number"] == 8
        finally:
            await _cleanup_user(db, username)

    async def test_includes_a_nearly_finished_episode(self, client, db):
        """Unlike Continue Watching's near-complete exclusion, "did I
        ever watch this" should say yes even for a nearly-finished
        episode — the detail page is asking a different question."""
        username = f"wp_latest_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 3,
                    "position_seconds": 2999.0,
                    "duration_seconds": 3000.0,
                },
            )

            resp = await client.get("/api/watch-progress/tv/1399/latest")
            assert resp.status_code == 200
            assert resp.json()["episode_number"] == 3
        finally:
            await _cleanup_user(db, username)

    async def test_requires_auth(self, client):
        resp = await client.get("/api/watch-progress/tv/1399/latest")
        assert resp.status_code == 401


class TestSeasonWatchProgress:
    """GET /watch-progress/tv/{tmdb_id}/season-progress?season_number=N —
    backs the episode list's "you've seen this one" highlighting."""

    async def test_only_episodes_with_progress_are_returned(self, client, db):
        username = f"wp_season_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 1,
                    "position_seconds": 300.0,
                    "duration_seconds": 3000.0,
                },
            )
            # Different season — must not show up in season 1's results.
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 2,
                    "episode_number": 1,
                    "position_seconds": 100.0,
                    "duration_seconds": 3000.0,
                },
            )

            resp = await client.get(
                "/api/watch-progress/tv/1399/season-progress", params={"season_number": 1}
            )
            assert resp.status_code == 200
            body = resp.json()
            assert len(body) == 1
            assert body[0]["episode_number"] == 1
            assert body[0]["season_number"] == 1
        finally:
            await _cleanup_user(db, username)

    async def test_includes_finished_episodes(self, client, db):
        """Unlike Continue Watching, a fully-finished episode should
        still be marked as "watched" here."""
        username = f"wp_season_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 1,
                    "position_seconds": 3000.0,
                    "duration_seconds": 3000.0,
                },
            )
            resp = await client.get(
                "/api/watch-progress/tv/1399/season-progress", params={"season_number": 1}
            )
            assert len(resp.json()) == 1
        finally:
            await _cleanup_user(db, username)

    async def test_empty_when_nothing_watched(self, client, db):
        username = f"wp_season_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            resp = await client.get(
                "/api/watch-progress/tv/1399/season-progress", params={"season_number": 1}
            )
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            await _cleanup_user(db, username)

    async def test_requires_auth(self, client):
        resp = await client.get(
            "/api/watch-progress/tv/1399/season-progress", params={"season_number": 1}
        )
        assert resp.status_code == 401

    async def test_no_route_collision_with_episode_progress_endpoint(self, client, db):
        """Regression check for the routing ambiguity considered while
        building this: .../tv/{tmdb_id}/{season_number}/{episode_number}
        must still resolve correctly and NOT be shadowed by, or shadow,
        .../tv/{tmdb_id}/season-progress."""
        username = f"wp_season_{uuid.uuid4().hex[:8]}"
        try:
            await _make_authed_client(client, db, username)
            await client.post(
                "/api/watch-progress",
                json={
                    "tmdb_id": 1399,
                    "media_type": "tv",
                    "season_number": 1,
                    "episode_number": 5,
                    "position_seconds": 42.0,
                    "duration_seconds": 3000.0,
                },
            )
            episode_resp = await client.get("/api/watch-progress/tv/1399/1/5")
            assert episode_resp.status_code == 200
            assert episode_resp.json()["position_seconds"] == 42.0

            season_resp = await client.get(
                "/api/watch-progress/tv/1399/season-progress", params={"season_number": 1}
            )
            assert season_resp.status_code == 200
            assert len(season_resp.json()) == 1
        finally:
            await _cleanup_user(db, username)
