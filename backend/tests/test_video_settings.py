"""/api/video-settings, the movie visit record, Clear history, and the
video_settings field on the playback source."""
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.providers import mock_provider
from app.services import auth_service, subtitle_service, watch_progress_service

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
def no_subtitle_lookup(monkeypatch):
    async def none(*a, **k):
        return None

    monkeypatch.setattr(subtitle_service, "get_default_english_track", none)


@pytest.fixture
def mock_video(tmp_path, monkeypatch):
    videos = tmp_path / "mock-videos"
    videos.mkdir()
    (videos / "test.mp4").write_bytes(b"fake")
    monkeypatch.setattr(mock_provider.get_settings(), "mock_videos_dir", str(videos))


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _login(client, db):
    name = f"vs_{uuid.uuid4().hex[:8]}"
    user = await auth_service.create_user(db, name, name.title(), "password123")
    client.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(user.id))
    return user, name


async def _cleanup(db, *names):
    await db.rollback()
    for n in names:
        u = await auth_service.get_user_by_username(db, n)
        if u is not None:
            await db.delete(u)
    await db.commit()


MOVIE = {"media_type": "movie", "tmdb_id": 603}
EP = {"media_type": "tv", "tmdb_id": 1396, "season_number": 2, "episode_number": 5}


class TestVideoSettings:
    @pytest.mark.parametrize("method", ["get", "patch", "delete"])
    async def test_requires_auth(self, client, method):
        kwargs = {"json": {"volume": 0.5}} if method == "patch" else {}
        assert (await getattr(client, method)("/api/video-settings", params=MOVIE, **kwargs)).status_code == 401

    async def test_empty_until_something_is_saved(self, client, db):
        _, name = await _login(client, db)
        try:
            assert (await client.get("/api/video-settings", params=MOVIE)).json() == {}
        finally:
            await _cleanup(db, name)

    async def test_patch_merges_and_null_forgets_a_key(self, client, db):
        _, name = await _login(client, db)
        try:
            a = await client.patch("/api/video-settings", params=EP, json={"volume": 0.4})
            assert a.json() == {"volume": 0.4}
            b = await client.patch("/api/video-settings", params=EP, json={"subtitle_language": "fa", "muted": True})
            assert b.json() == {"volume": 0.4, "subtitle_language": "fa", "muted": True}
            c = await client.patch("/api/video-settings", params=EP, json={"muted": None})
            assert c.json() == {"volume": 0.4, "subtitle_language": "fa"}
            assert (await client.get("/api/video-settings", params=EP)).json() == c.json()
        finally:
            await _cleanup(db, name)

    async def test_forgetting_the_last_key_removes_the_row(self, client, db):
        _, name = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.4})
            assert (await client.patch("/api/video-settings", params=MOVIE, json={"volume": None})).json() == {}
            assert (await client.get("/api/video-settings", params=MOVIE)).json() == {}
        finally:
            await _cleanup(db, name)

    async def test_each_video_has_its_own_settings(self, client, db):
        _, name = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.1})
            await client.patch("/api/video-settings", params=EP, json={"volume": 0.9})
            other_ep = {**EP, "episode_number": 6}
            assert (await client.get("/api/video-settings", params=MOVIE)).json() == {"volume": 0.1}
            assert (await client.get("/api/video-settings", params=EP)).json() == {"volume": 0.9}
            assert (await client.get("/api/video-settings", params=other_ep)).json() == {}
        finally:
            await _cleanup(db, name)

    @pytest.mark.parametrize(
        "body",
        [{"volume": 1.5}, {"volume": -0.1}, {"subtitle_language": "x"}, {"colour": "red"}, {"muted": "maybe"}],
    )
    async def test_invalid_or_unknown_keys_are_rejected_and_nothing_is_saved(self, client, db, body):
        _, name = await _login(client, db)
        try:
            assert (await client.patch("/api/video-settings", params=MOVIE, json=body)).status_code == 422
            assert (await client.get("/api/video-settings", params=MOVIE)).json() == {}
        finally:
            await _cleanup(db, name)

    async def test_an_episode_needs_season_and_episode(self, client, db):
        _, name = await _login(client, db)
        try:
            resp = await client.get("/api/video-settings", params={"media_type": "tv", "tmdb_id": 1})
            assert resp.status_code == 422
        finally:
            await _cleanup(db, name)

    async def test_settings_are_private_to_each_person(self, client, db):
        _, a = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.2})
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
                _, b = await _login(other, db)
                try:
                    assert (await other.get("/api/video-settings", params=MOVIE)).json() == {}
                finally:
                    await _cleanup(db, b)
        finally:
            await _cleanup(db, a)

    async def test_delete_one_and_delete_all(self, client, db):
        _, name = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.2})
            await client.patch("/api/video-settings", params=EP, json={"volume": 0.3})
            assert (await client.delete("/api/video-settings", params=MOVIE)).status_code == 204
            assert (await client.get("/api/video-settings", params=MOVIE)).json() == {}
            assert (await client.get("/api/video-settings", params=EP)).json() == {"volume": 0.3}
            assert (await client.delete("/api/video-settings/all")).json() == {"cleared": 1}
            assert (await client.get("/api/video-settings", params=EP)).json() == {}
        finally:
            await _cleanup(db, name)

    async def test_deleting_the_person_deletes_their_settings(self, client, db):
        user, name = await _login(client, db)
        uid = user.id
        await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.2})
        await _cleanup(db, name)
        from sqlalchemy import func, select

        from app.models.video_settings import VideoSettings

        assert (await db.scalar(select(func.count()).where(VideoSettings.user_id == uid))) == 0


class TestPlaybackSourceCarriesVideoSettings:
    async def test_movie_and_episode_sources_include_them(self, client, db, mock_video):
        _, name = await _login(client, db)
        try:
            assert (await client.get("/api/playback/movie/603")).json()["video_settings"] == {}
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.3})
            await client.patch("/api/video-settings", params=EP, json={"subtitle_language": "fa"})
            assert (await client.get("/api/playback/movie/603")).json()["video_settings"] == {"volume": 0.3}
            assert (await client.get("/api/playback/tv/1396/2/5")).json()["video_settings"] == {"subtitle_language": "fa"}
        finally:
            await _cleanup(db, name)


class TestMovieVisit:
    async def test_requires_auth(self, client):
        assert (await client.post("/api/watch-progress/movie/visit", json={"tmdb_id": 1})).status_code == 401

    async def test_creates_an_empty_row_that_keeps_real_progress_on_a_second_visit(self, client, db):
        user, name = await _login(client, db)
        uid = user.id
        try:
            assert (await client.post("/api/watch-progress/movie/visit", json={"tmdb_id": 603})).status_code == 204
            row = await watch_progress_service.get_progress(db, uid, 603, "movie", None, None)
            assert row.position_seconds == 0 and row.duration_seconds == 0

            await watch_progress_service.save_progress(db, uid, 603, "movie", None, None, 120.0, 5000.0)
            await client.post("/api/watch-progress/movie/visit", json={"tmdb_id": 603})
            await db.rollback()
            row = await watch_progress_service.get_progress(db, uid, 603, "movie", None, None)
            assert (row.position_seconds, row.duration_seconds) == (120.0, 5000.0)
        finally:
            await _cleanup(db, name)

    @respx.mock
    async def test_a_visited_movie_shows_in_continue_watching_without_any_position_save(self, client, db):
        respx.get("https://api.themoviedb.org/3/movie/603").mock(
            return_value=httpx.Response(
                200,
                json={"id": 603, "title": "The Matrix", "overview": "", "release_date": "1999-03-30", "genres": [],
                      "poster_path": None, "backdrop_path": None, "vote_average": 8.7},
            )
        )
        _, name = await _login(client, db)
        try:
            await client.post("/api/watch-progress/movie/visit", json={"tmdb_id": 603})
            items = (await client.get("/api/continue-watching")).json()["items"]
            assert [i["tmdb_id"] for i in items] == [603]
        finally:
            await _cleanup(db, name)


class TestClearHistory:
    async def test_requires_auth(self, client):
        assert (await client.delete("/api/watch-progress")).status_code == 401

    async def test_clears_only_my_history(self, client, db):
        me, mine = await _login(client, db)
        my_id = me.id
        try:
            await watch_progress_service.save_progress(db, my_id, 603, "movie", None, None, 10.0, 100.0)
            await watch_progress_service.save_progress(db, my_id, 1396, "tv", 1, 1, 10.0, 100.0)
            other = await auth_service.create_user(db, f"vs_{uuid.uuid4().hex[:8]}", "O", "password123")
            other_name, other_id = other.username, other.id
            await watch_progress_service.save_progress(db, other_id, 603, "movie", None, None, 50.0, 100.0)
            try:
                resp = await client.delete("/api/watch-progress")
                assert resp.json() == {"cleared": 2}
                await db.rollback()
                assert await watch_progress_service.get_progress(db, my_id, 603, "movie", None, None) is None
                assert await watch_progress_service.get_progress(db, other_id, 603, "movie", None, None) is not None
                assert (await client.get("/api/watch-progress/tv/1396/latest")).json() is None
                assert (await client.delete("/api/watch-progress")).json() == {"cleared": 0}
            finally:
                await _cleanup(db, other_name)
        finally:
            await _cleanup(db, mine)


class TestSubtitleOverrides:
    @pytest.fixture(autouse=True)
    def no_tmdb(self, monkeypatch):
        from app.services import tmdb_service

        async def boom(*a, **k):
            raise RuntimeError("offline")

        monkeypatch.setattr(tmdb_service, "get_movie", boom)
        monkeypatch.setattr(tmdb_service, "get_tv", boom)

    async def test_only_language_and_timing_are_stored_per_video(self, client, db):
        _, name = await _login(client, db)
        try:
            ok = await client.patch("/api/video-settings", params=EP, json={"subtitle_offset": -137.5, "subtitle_language": "fa"})
            assert ok.status_code == 200 and ok.json() == {"subtitle_offset": -137.5, "subtitle_language": "fa"}
            # the look is a site-wide setting now, not a per-video one
            for bad in ({"subtitle_color": "#FFE066"}, {"subtitle_font_size": 30}, {"subtitle_position": "top"}):
                assert (await client.patch("/api/video-settings", params=EP, json=bad)).status_code == 422
            assert (await client.get("/api/video-settings", params={**EP, "episode_number": 6})).json() == {}
        finally:
            await _cleanup(db, name)

    async def test_changing_the_site_wide_look_leaves_each_videos_language_and_timing_alone(self, client, db):
        _, name = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=EP, json={"subtitle_offset": 2.0, "subtitle_language": "fa"})
            res = await client.patch("/api/settings", json={"subtitles": {"color": "#ff0000", "font_size": 30}})
            assert res.status_code == 200 and res.json()["subtitles"]["color"] == "#ff0000"
            assert (await client.get("/api/video-settings", params=EP)).json() == {"subtitle_offset": 2.0, "subtitle_language": "fa"}
            # and the look is the same for every video, because it isn't per video
            assert (await client.get("/api/settings")).json()["subtitles"]["font_size"] == 30
        finally:
            await _cleanup(db, name)

    async def test_old_per_video_style_values_are_ignored_by_the_review_list(self, client, db):
        user, name = await _login(client, db)
        try:
            from app.models.video_settings import VideoSettings
            db.add(VideoSettings(user_id=user.id, tmdb_id=1396, media_type="tv", season_number=2, episode_number=5,
                                 data={"subtitle_color": "#FFE066", "subtitle_offset": 1.0}))
            db.add(VideoSettings(user_id=user.id, tmdb_id=603, media_type="movie", data={"subtitle_color": "#FFE066"}))
            await db.commit()
            listed = (await client.get("/api/video-settings/subtitles")).json()
            assert len(listed) == 1 and listed[0]["settings"] == {"subtitle_offset": 1.0}
        finally:
            await _cleanup(db, name)

    async def test_review_list_and_clearing(self, client, db):
        _, name = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=EP, json={"subtitle_language": "fa", "volume": 0.3})
            await client.patch("/api/video-settings", params=MOVIE, json={"volume": 0.2})  # no subtitle keys: not listed
            listed = (await client.get("/api/video-settings/subtitles")).json()
            assert len(listed) == 1
            assert listed[0]["tmdb_id"] == 1396 and listed[0]["season_number"] == 2 and listed[0]["episode_number"] == 5
            assert listed[0]["settings"] == {"subtitle_language": "fa"} and listed[0]["title"] is None

            assert (await client.delete("/api/video-settings/subtitles", params=EP)).status_code == 204
            assert (await client.get("/api/video-settings", params=EP)).json() == {"volume": 0.3}  # volume kept
            assert (await client.get("/api/video-settings/subtitles")).json() == []
        finally:
            await _cleanup(db, name)

    async def test_clear_all_and_privacy(self, client, db):
        _, a = await _login(client, db)
        try:
            await client.patch("/api/video-settings", params=EP, json={"subtitle_language": "fa"})
            await client.patch("/api/video-settings", params=MOVIE, json={"subtitle_offset": 1})
            client.cookies.clear()
            _, b = await _login(client, db)
            try:
                assert (await client.get("/api/video-settings/subtitles")).json() == []
                assert (await client.delete("/api/video-settings/subtitles/all")).json() == {"cleared": 0}
            finally:
                await _cleanup(db, b)
            client.cookies.clear()
            await client.post("/api/auth/login", json={"username": a, "password": "password123"})
            assert (await client.delete("/api/video-settings/subtitles/all")).json() == {"cleared": 2}
        finally:
            await _cleanup(db, a)

    async def test_review_endpoints_require_login(self, client):
        assert (await client.get("/api/video-settings/subtitles")).status_code == 401
        assert (await client.delete("/api/video-settings/subtitles/all")).status_code == 401
