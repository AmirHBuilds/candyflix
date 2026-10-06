"""
Phase 11 — subtitle sync: the job, its progress in Redis, the kept result, and
how the playback source offers it. The actual syncing script is replaced by a
tiny fake that prints the same JSON lines (its real accuracy is covered by the
standalone benchmark); everything around it is real: routes, Postgres, Redis,
subprocess handling, files.
"""
import asyncio
import json
import textwrap
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
import app.services.subtitle_service as subtitle_service
import app.services.subtitle_sync_service as sync_service
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service

pytestmark = pytest.mark.asyncio

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n"

FAKE_OK = textwrap.dedent('''
    import json, sys, time
    out = sys.argv[sys.argv.index("-o") + 1]
    for p, m in [(3, "Extracting audio and finding speech"), (72, "Matched the overall timing"), (94, "Checking the result")]:
        print(json.dumps({"percent": p, "stage": "x", "message": m}), flush=True)
        time.sleep(%(pause)s)
    open(out, "w").write("1\\n00:00:02,000 --> 00:00:03,000\\nHello\\n")
    print(json.dumps({"result": {"improved": True, "method_used": "global", "segments": [],
        "global_pass": {"offset_seconds": 1.0, "framerate_scale": 1.0},
        "quality": {"speech_overlap_before": 0.3, "speech_overlap_after": 0.43}}}), flush=True)
''')
FAKE_UNCHANGED = textwrap.dedent('''
    import json
    print(json.dumps({"result": {"improved": False, "method_used": None, "segments": [],
        "global_pass": {"offset_seconds": 0.05, "framerate_scale": 1.0}, "quality": {}}}))
''')
FAKE_UNSURE = FAKE_UNCHANGED.replace("0.05", "7.0")
FAKE_CRASH = "import sys\nprint('boom')\nsys.exit(3)\n"


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for k in await redis.keys("subsync:*"):
        await redis.delete(k)
    yield
    await redis.aclose()
    redis_module._redis_client = None
    sync_service._semaphore = None
    sync_service._tasks.clear()


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
def no_default_subtitle(monkeypatch):
    monkeypatch.setattr(subtitle_service, "get_default_english_track", AsyncMock(return_value=None))


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    settings = get_settings()
    subs, syncs, videos = tmp_path / "subs", tmp_path / "sync", tmp_path / "videos"
    for d in (subs, syncs, videos):
        d.mkdir()
    (videos / "movie.mp4").write_bytes(b"not really a video")
    (subs / "movie-603-en-42.srt").write_text(SRT)
    monkeypatch.setattr(settings, "subtitle_cache_dir", str(subs))
    monkeypatch.setattr(settings, "sync_cache_dir", str(syncs))
    monkeypatch.setattr(settings, "mock_videos_dir", str(videos))
    return tmp_path


def use_fake(monkeypatch, tmp_path, source: str, pause: float = 0):
    script = tmp_path / "fake_sync.py"
    script.write_text(source % {"pause": pause} if "%(pause)s" in source else source)
    monkeypatch.setattr(sync_service, "SCRIPT", script)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def authed(client):
    username = f"sync_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, username, "Sync Tester", "testpass123")
        token = await auth_service.create_session(user.id)
        client.cookies.set(SESSION_COOKIE_NAME, token)
        uid = user.id
    yield client
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, username)
        if u:
            await db.delete(u)
            await db.commit()


BODY = {
    "media_type": "movie",
    "tmdb_id": 603,
    "subtitle_url": "/subtitle-cache/movie-603-en-42.srt",
    "language": "en",
    "label": "English",
}
STATUS_Q = {"media_type": "movie", "tmdb_id": 603, "subtitle_url": BODY["subtitle_url"]}


async def wait_for(client, states, timeout=15):
    for _ in range(int(timeout / 0.05)):
        r = (await client.get("/api/subtitle-sync/status", params=STATUS_Q)).json()
        if r["state"] in states:
            return r
        await asyncio.sleep(0.05)
    raise AssertionError(f"never reached {states}; last {r}")


class TestSyncRoutes:
    async def test_requires_auth(self, client, dirs):
        assert (await client.post("/api/subtitle-sync", json=BODY)).status_code == 401
        assert (await client.get("/api/subtitle-sync/status", params=STATUS_Q)).status_code == 401

    async def test_idle_before_anything_is_started(self, authed, dirs):
        r = await authed.get("/api/subtitle-sync/status", params=STATUS_Q)
        assert r.json()["state"] == "idle"

    async def test_syncs_keeps_the_file_and_reports_progress(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK, pause=0.4)
        first = (await authed.post("/api/subtitle-sync", json=BODY)).json()
        assert first["state"] in ("queued", "running")

        running = await wait_for(authed, {"running"})
        assert running["message"]  # the status line under the button
        seen = {running["percent"]}
        done = None
        for _ in range(200):
            r = (await authed.get("/api/subtitle-sync/status", params=STATUS_Q)).json()
            seen.add(r["percent"])
            if r["state"] == "done":
                done = r
                break
            await asyncio.sleep(0.05)
        assert done, "never finished"
        assert len(seen) > 2  # real intermediate percentages were visible
        assert done["track"]["synced"] is True
        assert done["track"]["language"] == "en"
        url = done["track"]["url"]
        assert url.startswith("/subtitle-cache/sync-")
        kept = (dirs / "subs" / url.rsplit("/", 1)[1]).read_text()
        assert "00:00:02,000" in kept
        # the original is untouched
        assert (dirs / "subs" / "movie-603-en-42.srt").read_text() == SRT
        # no temp file left behind
        assert not list((dirs / "sync").glob("tmp-*"))

    async def test_state_survives_a_fresh_client_like_a_page_refresh(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK, pause=0.5)
        await authed.post("/api/subtitle-sync", json=BODY)
        await wait_for(authed, {"running"})
        # "refresh": a brand new request context, same server
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", cookies=authed.cookies) as other:
            r = (await other.get("/api/subtitle-sync/status", params=STATUS_Q)).json()
        assert r["state"] == "running" and r["percent"] >= 1

    async def test_second_request_reuses_the_kept_file(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK)
        await authed.post("/api/subtitle-sync", json=BODY)
        await wait_for(authed, {"done"})
        use_fake(monkeypatch, dirs, FAKE_CRASH)  # would fail if it ran again
        again = (await authed.post("/api/subtitle-sync", json=BODY)).json()
        assert again["state"] == "done" and again["track"]["synced"] is True

    async def test_double_click_starts_one_job(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK, pause=0.2)
        a, b = await asyncio.gather(authed.post("/api/subtitle-sync", json=BODY), authed.post("/api/subtitle-sync", json=BODY))
        assert a.status_code == b.status_code == 200
        await wait_for(authed, {"done"})
        assert len(list((dirs / "subs").glob("sync-*.srt"))) == 1

    async def test_already_in_sync_is_reported_calmly(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_UNCHANGED)
        await authed.post("/api/subtitle-sync", json=BODY)
        r = await wait_for(authed, {"unchanged", "failed"})
        assert r["state"] == "unchanged" and "already" in r["message"]
        assert not list((dirs / "subs").glob("sync-*"))

    async def test_unsure_result_keeps_the_original(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_UNSURE)
        await authed.post("/api/subtitle-sync", json=BODY)
        r = await wait_for(authed, {"unchanged", "failed"})
        assert r["state"] == "failed" and "confidently" in r["message"]
        assert not list((dirs / "subs").glob("sync-*"))

    async def test_crashing_script_fails_politely_and_can_be_retried(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_CRASH)
        await authed.post("/api/subtitle-sync", json=BODY)
        r = await wait_for(authed, {"failed"})
        assert "boom" not in json.dumps(r)  # internals aren't shown to the viewer
        use_fake(monkeypatch, dirs, FAKE_OK)
        await authed.post("/api/subtitle-sync", json=BODY)
        assert (await wait_for(authed, {"done"}))["track"]["synced"]

    async def test_interrupted_job_is_reported_not_stuck(self, authed, dirs):
        # Redis says "running", but no task in this process (server restarted).
        vkey = sync_service.video_key("movie", 603, None, None)
        await sync_service._set_state(sync_service._job_id(vkey, "movie-603-en-42.srt"), "running", 40, "x", "Working")
        r = (await authed.get("/api/subtitle-sync/status", params=STATUS_Q)).json()
        assert r["state"] == "failed" and "interrupted" in r["message"]

    async def test_rejects_paths_that_are_not_cached_subtitles(self, authed, dirs):
        for bad in ("/subtitle-cache/../../etc/passwd", "/mock-videos/movie.mp4", "https://evil/x.srt", "/subtitle-cache/nope.srt"):
            r = await authed.post("/api/subtitle-sync", json={**BODY, "subtitle_url": bad})
            assert r.status_code in (400, 404, 422), bad

    async def test_cannot_sync_a_synced_subtitle_again(self, authed, dirs):
        (dirs / "subs" / "sync-abc-def.srt").write_text(SRT)
        r = await authed.post("/api/subtitle-sync", json={**BODY, "subtitle_url": "/subtitle-cache/sync-abc-def.srt"})
        assert r.status_code == 400

    async def test_no_video_gives_a_clear_error(self, authed, dirs):
        (dirs / "videos" / "movie.mp4").unlink()
        r = await authed.post("/api/subtitle-sync", json=BODY)
        assert r.status_code == 404

    async def test_jobs_run_one_at_a_time(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK, pause=0.4)
        (dirs / "subs" / "movie-603-en-99.srt").write_text(SRT)
        await authed.post("/api/subtitle-sync", json=BODY)
        await wait_for(authed, {"running"})
        await authed.post("/api/subtitle-sync", json={**BODY, "subtitle_url": "/subtitle-cache/movie-603-en-99.srt"})
        q = {**STATUS_Q, "subtitle_url": "/subtitle-cache/movie-603-en-99.srt"}
        r = (await authed.get("/api/subtitle-sync/status", params=q)).json()
        assert r["state"] == "queued" and "Waiting" in r["message"]
        await wait_for(authed, {"done"})


class TestPlaybackOffersSyncedTrack:
    async def test_synced_track_replaces_the_original_of_the_same_language(self, authed, dirs, monkeypatch):
        from app.schemas.playback import SubtitleTrackOut

        default = SubtitleTrackOut(language="en", label="English", url="/subtitle-cache/movie-603-en-42.srt", format="srt")
        monkeypatch.setattr(subtitle_service, "get_default_english_track", AsyncMock(return_value=default))

        before = (await authed.get("/api/playback/movie/603")).json()
        assert [t["synced"] for t in before["subtitles"]] == [False]

        use_fake(monkeypatch, dirs, FAKE_OK)
        await authed.post("/api/subtitle-sync", json=BODY)
        await wait_for(authed, {"done"})

        after = (await authed.get("/api/playback/movie/603")).json()
        assert [(t["language"], t["synced"]) for t in after["subtitles"]] == [("en", True)]

    async def test_other_videos_are_unaffected(self, authed, dirs, monkeypatch):
        use_fake(monkeypatch, dirs, FAKE_OK)
        await authed.post("/api/subtitle-sync", json=BODY)
        await wait_for(authed, {"done"})
        other = (await authed.get("/api/playback/movie/604")).json()
        assert other["subtitles"] == []
