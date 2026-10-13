"""Subtitle sync against real (resolver) video: the audio is pulled out of the playing download, a subtitle
that came from the resolver is converted, and any failure is recorded and reported to Telegram."""
import asyncio
import json
import stat
import textwrap
import uuid

import pytest
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
import app.services.subtitle_service as subtitle_service
import app.services.subtitle_sync_service as sync_service
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service, resolver_service, telegram_service
from unittest.mock import AsyncMock

pytestmark = pytest.mark.asyncio

REAL_REPORT = telegram_service.report_sync_failure
BASE = "http://resolver.test"
VTT = "WEBVTT\n\nNOTE hi\n\n1\n00:01.000 --> 00:02.500 align:start\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld\n"
FAKE_SYNC = textwrap.dedent('''
    import json, sys
    out = sys.argv[sys.argv.index("-o") + 1]
    open(out, "w").write("1\\n00:00:02,000 --> 00:00:03,000\\nHello\\n")
    open(out + ".media", "w").write(sys.argv[1])
    print(json.dumps({"percent": 50, "stage": "x", "message": "half"}), flush=True)
    print(json.dumps({"result": {"improved": True, "method_used": "global", "segments": [],
        "global_pass": {"offset_seconds": 1.0, "framerate_scale": 1.0}, "quality": {}}}), flush=True)
''')


def fake_resolver(state):
    fake = FastAPI()

    @fake.get("/v1/library/{item_id}")
    async def item(item_id: str):
        return {"id": item_id, "task_id": "t", "stream_id": "s", "source": "Vertex", "quality": "800p", "status": state["status"],
                "stream_url": f"{BASE}/s/index.m3u8?sig=1", "duration_s": 100.0, "playable": True}

    @fake.get("/subs/en.vtt")
    async def vtt():
        return PlainTextResponse(VTT)

    return fake


@pytest.fixture(autouse=True)
async def env(tmp_path, monkeypatch):
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for k in await redis.keys("subsync:*"):
        await redis.delete(k)
    s = get_settings()
    subs, syncs = tmp_path / "subs", tmp_path / "sync"
    subs.mkdir(); syncs.mkdir()
    monkeypatch.setattr(s, "subtitle_cache_dir", str(subs))
    monkeypatch.setattr(s, "sync_cache_dir", str(syncs))
    monkeypatch.setattr(s, "resolver_url", BASE)
    monkeypatch.setattr(s, "resolver_api_key", "k")
    state = {"status": "ready"}
    monkeypatch.setattr(resolver_service, "_transport", ASGITransport(app=fake_resolver(state)))
    monkeypatch.setattr(subtitle_service, "get_default_english_track", AsyncMock(return_value=None))
    script = tmp_path / "fake_sync.py"
    script.write_text(FAKE_SYNC)
    monkeypatch.setattr(sync_service, "SCRIPT", script)
    # a fake ffmpeg: records its arguments and writes the output file (the last argument)
    ff = tmp_path / "ffmpeg"
    ff.write_text(f'#!/usr/bin/env python3\nimport sys, json\nargs = sys.argv[1:]\nopen(r"{tmp_path}/ffmpeg-args.json", "w").write(json.dumps(args))\n'
                  f'if r"{tmp_path}/FAIL" and __import__("os").path.exists(r"{tmp_path}/FAIL"):\n    sys.stderr.write("Server returned 403 Forbidden"); sys.exit(1)\n'
                  'print("out_time_us=50000000", flush=True)\nopen(args[-1], "wb").write(b"x" * 5000)\n')
    ff.chmod(ff.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(sync_service.shutil, "which", lambda name: str(ff) if name == "ffmpeg" else None)
    reports = []
    monkeypatch.setattr(telegram_service, "report_sync_failure", lambda *a: reports.append(a))
    yield {"state": state, "tmp": tmp_path, "reports": reports, "syncs": syncs, "subs": subs}
    await redis.aclose()
    redis_module._redis_client = None
    sync_service._semaphore = None
    sync_service._tasks.clear()
    await engine.dispose()


@pytest.fixture
async def authed():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        name = f"sr_{uuid.uuid4().hex[:8]}"
        async with AsyncSessionLocal() as db:
            u = await auth_service.create_user(db, name, "T", "testpass123")
            ac.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(u.id))
        yield ac


RELAY = f"/api/resolve/relay?u=http%3A%2F%2Fresolver.test%2Fsubs%2Fen.vtt"
BODY = {"media_type": "movie", "tmdb_id": 550, "subtitle_url": RELAY, "language": "en", "label": "English", "library_id": "lib_1"}
Q = {"media_type": "movie", "tmdb_id": 550, "subtitle_url": RELAY}


async def wait_state(c, states):
    for _ in range(300):
        r = (await c.get("/api/subtitle-sync/status", params=Q)).json()
        if r["state"] in states:
            return r
        await asyncio.sleep(0.05)
    raise AssertionError(r)


def test_vtt_becomes_srt():
    srt = sync_service.vtt_to_srt(VTT)
    assert "1\n00:00:01,000 --> 00:00:02,500\nHello" in srt
    assert "2\n00:00:03,000 --> 00:00:04,000\nWorld" in srt
    assert "WEBVTT" not in srt and "NOTE" not in srt and "align" not in srt


async def test_syncs_a_resolver_subtitle_against_the_audio_of_the_playing_video(authed, env):
    first = await authed.post("/api/subtitle-sync", json=BODY)
    assert first.status_code == 200
    done = await wait_state(authed, {"done", "failed"})
    assert done["state"] == "done" and done["track"]["synced"] is True
    args = json.loads((env["tmp"] / "ffmpeg-args.json").read_text())
    assert args[args.index("-i") + 1] == f"{BASE}/s/index.m3u8?sig=1"
    assert "-vn" in args and args[args.index("-map") + 1] == "0:a:0" and "flac" in args
    # the sync tool got the extracted audio, not the stream link
    media = next(env["syncs"].glob("tmp-*"), None)
    assert media is None  # temp files are cleaned up
    assert list(env["syncs"].glob("audio-*.flac"))
    assert list(env["subs"].glob("rs-*.srt"))  # the converted subtitle
    assert env["reports"] == []


async def test_waits_for_the_download_to_finish(authed, env):
    env["state"]["status"] = "downloading"
    r = await authed.post("/api/subtitle-sync", json=BODY)
    assert r.status_code == 409 and "finished downloading" in r.json()["detail"]


async def test_needs_to_know_which_video(authed, env):
    r = await authed.post("/api/subtitle-sync", json={**BODY, "library_id": None})
    assert r.status_code == 404


async def test_an_audio_failure_is_recorded_and_reported(authed, env):
    (env["tmp"] / "FAIL").write_text("1")
    await authed.post("/api/subtitle-sync", json=BODY)
    failed = await wait_state(authed, {"failed"})
    assert "admins were told" in failed["message"]
    assert len(env["reports"]) == 1
    video, subtitle, stage, detail, media = env["reports"][0]
    assert stage == "audio" and "403" in detail and media == "Vertex 800p" and video.startswith("movie:550")
    line = json.loads((env["syncs"] / "failures.jsonl").read_text().splitlines()[0])
    assert line["stage"] == "audio" and "403" in line["detail"]


async def test_a_sync_tool_failure_is_reported_too(authed, env, monkeypatch):
    (env["tmp"] / "fake_sync.py").write_text("import sys\nprint('boom')\nsys.exit(3)\n")
    await authed.post("/api/subtitle-sync", json=BODY)
    await wait_state(authed, {"failed"})
    assert env["reports"][0][2] == "sync" and "boom" in env["reports"][0][3]


def test_the_telegram_report_goes_to_the_errors_topic(monkeypatch):
    sent = []
    monkeypatch.setattr(telegram_service, "notify", lambda topic, text, **k: sent.append((topic, text)))
    REAL_REPORT("movie:1:0:0", "x.srt", "audio", "<bad>", "Vertex 800p")
    assert sent[0][0] == "errors" and "Subtitle sync failed" in sent[0][1] and "&lt;bad&gt;" in sent[0][1]
