"""Candy Resolver integration: start, auto-download, switching quality, relay, subtitles, age limits.
The resolver itself is a small fake app plugged in through an ASGI transport."""
import uuid

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.schemas.media import MovieDetail
from app.services import auth_service, resolver_service, tmdb_service

pytestmark = pytest.mark.asyncio

BASE = "http://resolver.test"


def make_fake():
    fake = FastAPI()
    st = {"tasks": {}, "library": [], "calls": [], "subs_asked": 0, "subs_ready": False}
    fake.state.st = st

    def stream(i, q):
        return {"id": f"str_{i}", "quality": q, "format": "hls", "url": f"https://up/{i}.m3u8", "size": None, "headers": {}}

    def task_out(t):
        return {**t, "library": [i for i in st["library"] if i["task_id"] == t["task_id"]]}

    @fake.post("/v1/resolve")
    async def resolve(req: Request):
        body = await req.json()
        st["calls"].append(("resolve", dict(req.query_params), body))
        assert req.headers["x-api-key"] == "k"
        t = {
            "task_id": "tsk_1", "status": "running", "tmdb_id": body["tmdb_id"], "type": body["type"],
            "season": body.get("season"), "episode": body.get("episode"), "title": "T", "version": 1,
            "sources_total": 2, "sources_done": 1, "queue_position": 3,
            "sources": [
                {"source": "Vertex", "starred": True, "status": "ok", "error": None, "duration_ms": 5,
                 "streams": [stream("a", "534p"), stream("b", "800p"), stream("c", "auto"), stream("d", "266p")],
                 "subtitles": [], "audio": []},
                {"source": "Other", "starred": False, "status": "ok", "error": None, "duration_ms": 9,
                 "streams": [stream("e", "1080p")], "subtitles": [], "audio": []},
            ],
        }
        st["tasks"]["tsk_1"] = t
        return JSONResponse(task_out(t), status_code=202)

    @fake.get("/v1/tasks/{tid}")
    async def get_task(tid: str):
        if tid not in st["tasks"]:
            return JSONResponse({}, status_code=404)
        return task_out(st["tasks"][tid])

    @fake.post("/v1/tasks/{tid}/library")
    async def lib(tid: str, req: Request):
        body = await req.json()
        st["calls"].append(("library", body))
        item = {
            "id": f"lib_{len(st['library'])}", "task_id": tid, "stream_id": body["stream_id"], "source": "Vertex",
            "quality": {"a": "534p", "b": "800p", "e": "1080p"}.get(body["stream_id"], "auto"), "format": "hls", "status": "downloading",
            "progress": 0.25, "size": None, "total_bytes": None, "playable": True,
            "stream_url": f"{BASE}/s/{body['stream_id']}/index.m3u8?sig=1", "url": None,
            "requested_at": f"2026-10-12T06:3{len(st['library'])}:00Z", "subtitles": [],
        }
        st["library"].append(item)
        return JSONResponse(item, status_code=202)

    @fake.get("/v1/tasks")
    async def tasks_list(req: Request):
        return [{k: v for k, v in t.items() if k not in ("sources",)} for t in st["tasks"].values() if t["tmdb_id"] == int(req.query_params["tmdb_id"])]

    @fake.get("/v1/library")
    async def library(req: Request):
        return [i for i in st["library"] if i.get("tmdb_id") == int(req.query_params["tmdb_id"])]

    @fake.get("/v1/tasks/{tid}/subtitles")
    async def subs_get(tid: str):
        if not st["subs_asked"]:
            return JSONResponse({}, status_code=404)
        if not st["subs_ready"]:
            return {"id": "x", "task_id": tid, "status": "pending", "subtitles": [], "ttl_hours": 24}
        return {"id": "x", "task_id": tid, "status": "ready", "ttl_hours": 24, "subtitles": [
            {"lang": "en", "label": "English", "url": f"{BASE}/subs/en.vtt", "format": "vtt", "source": "Vertex"},
            {"lang": "fa", "label": "Persian", "url": f"{BASE}/subs/fa.vtt", "format": "vtt", "source": "Other"},
        ]}

    @fake.post("/v1/tasks/{tid}/subtitles")
    async def subs_post(tid: str):
        st["subs_asked"] += 1
        return JSONResponse({"status": "pending"}, status_code=202)

    @fake.get("/s/{sid}/index.m3u8")
    async def playlist(sid: str, request: Request):
        text = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:6,\nseg0.ts\n#EXTINF:6,\nhttp://resolver.test/s/x/seg1.ts?t=9\n"
        return Response(text, media_type="application/vnd.apple.mpegurl")

    @fake.get("/s/{sid}/seg0.ts")
    async def seg(sid: str, request: Request):
        data = b"0123456789"
        rng = request.headers.get("range")
        if rng:
            return Response(data[2:6], status_code=206, media_type="video/mp2t", headers={"Content-Range": "bytes 2-5/10"})
        return Response(data, media_type="video/mp2t")

    return fake


@pytest.fixture(autouse=True)
async def env(monkeypatch):
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for k in await redis.keys("resolver:*"):
        await redis.delete(k)

    s = get_settings()
    monkeypatch.setattr(s, "resolver_url", BASE)
    monkeypatch.setattr(s, "resolver_api_key", "k")
    monkeypatch.setattr(s, "resolver_stream_mode", "proxy")
    fake = make_fake()
    monkeypatch.setattr(resolver_service, "_transport", ASGITransport(app=fake))

    async def cert(kind, i):
        return {("movie", 4): "R"}.get((kind, i), "G")

    async def adult(kind, i):
        return False

    monkeypatch.setattr(tmdb_service, "get_certification", cert)
    monkeypatch.setattr(tmdb_service, "is_adult_flagged", adult)
    yield fake.state.st
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None
    await engine.dispose()


async def client(limit=None):
    name = f"rs_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        u = await auth_service.create_user(db, name, name.title(), "password123", age_limit=limit)
        await db.commit()
        uid = u.id
    ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    ac.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))
    return ac


START = {"media_type": "movie", "tmdb_id": 550}


def stream_of(state, sid):
    return next(s for src in state["sources"] for s in src["streams"] if s["stream_id"] == sid)


async def test_start_downloads_the_best_quality_of_the_first_source(env):
    c = await client()
    r = await c.post("/api/resolve/start", json=START)
    assert r.status_code == 200
    s = r.json()
    assert env["calls"][0][1] == {"wait": "first", "wait_s": "25"}
    assert env["calls"][0][2]["starred_first"] is True
    lib = [c_ for c_ in env["calls"] if c_[0] == "library"]
    assert len(lib) == 1  # only one download, not every quality
    assert lib[0][1]["stream_id"] == "str_b"  # 800p of the first source, not the 1080p of the second
    assert lib[0][1]["progressive"] is True and lib[0][1]["ttl_hours"] == 24
    assert lib[0][1]["subtitles"] is True and lib[0][1]["subtitle_langs"] == []
    assert s["auto_stream_id"] == "str_b" and s["queue_position"] == 3
    assert [x["name"] for x in s["sources"]] == ["Vertex", "Other"]
    assert [q["quality"] for q in s["sources"][0]["streams"]] == ["800p", "534p", "266p", "Auto"]
    b = stream_of(s, "str_b")
    assert b["state"] == "downloading" and b["progress"] == 25.0
    assert b["play_url"].startswith("/api/resolve/relay?u=")
    assert stream_of(s, "str_e")["state"] == "idle" and stream_of(s, "str_e")["play_url"] is None
    await c.aclose()


async def test_clicking_another_quality_downloads_it_once(env):
    c = await client()
    tid = (await c.post("/api/resolve/start", json=START)).json()["task_id"]
    for _ in range(3):
        r = await c.post(f"/api/resolve/tasks/{tid}/download", json={"stream_id": "str_e"})
        assert r.status_code == 200
    assert [x[1]["stream_id"] for x in env["calls"] if x[0] == "library"] == ["str_b", "str_e"]
    s = r.json()
    assert stream_of(s, "str_e")["state"] == "downloading" and stream_of(s, "str_b")["state"] == "downloading"
    assert s["auto_stream_id"] == "str_b"  # the first one stays the automatic pick
    assert (await c.post(f"/api/resolve/tasks/{tid}/download", json={"stream_id": "nope"})).status_code == 404
    await c.aclose()


async def test_progress_ready_and_percentage_forms(env):
    c = await client()
    tid = (await c.post("/api/resolve/start", json=START)).json()["task_id"]
    item = env["library"][0]
    item.update(progress=61.0, status="downloading")
    assert stream_of((await c.get(f"/api/resolve/tasks/{tid}")).json(), "str_b")["progress"] == 61.0
    item.update(size=50, total_bytes=200)
    assert stream_of((await c.get(f"/api/resolve/tasks/{tid}")).json(), "str_b")["progress"] == 25.0
    item.update(status="ready")
    b = stream_of((await c.get(f"/api/resolve/tasks/{tid}")).json(), "str_b")
    assert b["state"] == "ready" and b["progress"] == 100.0
    item.update(status="failed", error="boom")
    b = stream_of((await c.get(f"/api/resolve/tasks/{tid}")).json(), "str_b")
    assert b["state"] == "failed" and b["play_url"] is None and b["error"] == "boom"
    await c.aclose()


async def test_subtitles_from_every_source_and_not_the_seek_sprites(env):
    c = await client()
    tid = (await c.post("/api/resolve/start", json=START)).json()["task_id"]
    env["library"][0]["subtitles"] = [
        {"lang": "und", "label": "und", "url": f"{BASE}/static/i0ie/thumbnails.vtt", "format": "vtt"},
        {"lang": "en", "label": "English", "url": f"{BASE}/subs/en.vtt", "format": "vtt"},
    ]
    # The task is still running: only the downloaded source's own subtitles, sprites dropped.
    subs = (await c.get(f"/api/resolve/tasks/{tid}")).json()["subtitles"]
    assert [x["language"] for x in subs] == ["en"]
    # Once the task is done, every source's subtitles are asked for, then merged without repeats.
    env["tasks"][tid]["status"] = "done"
    assert (await c.get(f"/api/resolve/tasks/{tid}")).json()["subtitles"][0]["language"] == "en"
    assert env["subs_asked"] == 1
    env["subs_ready"] = True
    subs = (await c.get(f"/api/resolve/tasks/{tid}")).json()["subtitles"]
    assert sorted(x["language"] for x in subs) == ["en", "fa"]
    assert subs[0]["url"].startswith("/api/resolve/relay?u=")
    await c.aclose()


async def test_an_already_downloaded_title_skips_the_search(env):
    c = await client()
    await c.post("/api/resolve/start", json=START)
    env["library"][0].update(status="ready", tmdb_id=550)
    env["calls"].clear()
    r = await c.post("/api/resolve/start", json=START)
    assert r.status_code == 200
    assert [x[0] for x in env["calls"]] == []  # no new resolve, no new download
    s = r.json()
    assert stream_of(s, "str_b")["state"] == "ready" and s["auto_stream_id"] == "str_b"
    await c.aclose()


async def test_direct_mode_gives_the_resolvers_own_link(env, monkeypatch):
    monkeypatch.setattr(get_settings(), "resolver_stream_mode", "direct")
    c = await client()
    s = (await c.post("/api/resolve/start", json=START)).json()
    assert stream_of(s, "str_b")["play_url"] == f"{BASE}/s/str_b/index.m3u8?sig=1"
    await c.aclose()


async def test_relay_rewrites_playlists_and_passes_ranges(env):
    c = await client()
    s = (await c.post("/api/resolve/start", json=START)).json()
    url = stream_of(s, "str_b")["play_url"]
    pl = await c.get(url)
    assert pl.status_code == 200 and pl.headers["cache-control"] == "no-store"
    lines = pl.text.splitlines()
    assert 'URI="relay?u=' in lines[2]
    segs = [l for l in lines if l.startswith("relay?u=")]
    assert len(segs) == 2 and "seg0.ts" in segs[0] and "sig%3D1" in segs[0]  # inherits the playlist's signature
    assert "seg1.ts%3Ft%3D9" in segs[1]  # keeps its own
    seg = await c.get("/api/resolve/" + segs[0])
    assert seg.status_code == 200 and seg.content == b"0123456789"
    part = await c.get("/api/resolve/" + segs[0], headers={"Range": "bytes=2-5"})
    assert part.status_code == 206 and part.content == b"2345" and part.headers["content-range"] == "bytes 2-5/10"
    await c.aclose()


async def test_relay_refuses_other_hosts_and_needs_sign_in(env):
    c = await client()
    for bad in ("http://evil.test/x.ts", "file:///etc/passwd", "http://localhost:8000/api/health"):
        assert (await c.get("/api/resolve/relay", params={"u": bad})).status_code == 400
    anon = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    assert (await anon.get("/api/resolve/relay", params={"u": f"{BASE}/s/a/seg0.ts"})).status_code == 401
    assert (await anon.post("/api/resolve/start", json=START)).status_code == 401
    await c.aclose(); await anon.aclose()


async def test_age_limits_apply(env):
    c = await client(limit="PG")
    r = await c.post("/api/resolve/start", json={"media_type": "movie", "tmdb_id": 4})
    assert r.status_code in (403, 404)
    assert [x for x in env["calls"] if x[0] == "resolve"] == []
    await c.aclose()


async def test_series_needs_season_and_episode(env):
    c = await client()
    assert (await c.post("/api/resolve/start", json={"media_type": "tv", "tmdb_id": 1})).status_code == 422
    await c.aclose()


async def test_playback_route_says_resolver_when_configured(env, monkeypatch):
    async def none(*a, **k):
        return None

    import app.services.subtitle_service as subtitle_service
    monkeypatch.setattr(subtitle_service, "get_default_english_track", none)
    c = await client()
    r = await c.get("/api/playback/movie/550")
    assert r.status_code == 200 and r.json()["source_type"] == "resolver" and r.json()["url"] == ""
    monkeypatch.setattr(get_settings(), "resolver_url", "")
    assert (await c.post("/api/resolve/start", json=START)).status_code == 404
    await c.aclose()


async def test_unreachable_resolver_is_a_clean_error(env, monkeypatch):
    class Boom(ASGITransport):
        async def handle_async_request(self, request):
            import httpx
            raise httpx.ConnectError("down")

    monkeypatch.setattr(resolver_service, "_transport", Boom(app=make_fake()))
    c = await client()
    r = await c.post("/api/resolve/start", json=START)
    assert r.status_code == 502 and "video service" in r.json()["detail"]
    await c.aclose()


async def test_a_refresh_carries_on_with_the_download_that_is_running(env):
    c = await client()
    first = (await c.post("/api/resolve/start", json=START)).json()
    env["library"][0].update(tmdb_id=550, progress=0.4)
    env["calls"].clear()
    again = (await c.post("/api/resolve/start", json=START)).json()
    assert [x[0] for x in env["calls"]] == []  # no new search, no second download
    assert again["task_id"] == first["task_id"] and again["auto_stream_id"] == "str_b"
    assert stream_of(again, "str_b")["state"] == "downloading" and stream_of(again, "str_b")["progress"] == 40.0
    await c.aclose()


async def test_a_refresh_right_after_the_search_reuses_the_task(env):
    c = await client()
    env["tasks"]["tsk_1"] = {
        "task_id": "tsk_1", "status": "running", "tmdb_id": 550, "type": "movie", "season": None, "episode": None,
        "title": "T", "version": 2, "sources_total": 2, "sources_done": 1, "sources": [], "library": [],
    }
    r = (await c.post("/api/resolve/start", json=START)).json()
    assert r["task_id"] == "tsk_1" and r["status"] == "running"
    assert [x for x in env["calls"] if x[0] == "resolve"] == []  # reused the running search
    await c.aclose()


async def test_the_best_ready_download_beats_one_still_running(env):
    c = await client()
    tid = (await c.post("/api/resolve/start", json=START)).json()["task_id"]
    await c.post(f"/api/resolve/tasks/{tid}/download", json={"stream_id": "str_a"})
    for it in env["library"]:
        it["tmdb_id"] = 550
    env["library"][1].update(status="ready")  # the 534p one is done, the 800p one is not
    env["calls"].clear()
    s = (await c.post("/api/resolve/start", json=START)).json()
    assert s["auto_stream_id"] == "str_a"
    await c.aclose()
