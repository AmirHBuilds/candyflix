"""The error log: failures are stored (repeats counted), sent to Telegram once, and shown to admins."""
import asyncio
import logging

import pytest
from sqlalchemy import delete, select

from app.models.error_log import ErrorLog
from app.services import error_log_service, telegram_service
from tests.test_admin_activity import (  # noqa: F401  (fixtures)
    _cleanup,
    _make,
    as_,
    clean_redis,
    client,
    db,
    dispose_db_pool,
    fake_tmdb,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clean_log(monkeypatch, dispose_db_pool):
    sent = []

    async def fake_send(topic, text):
        sent.append((topic, text))
        return True

    monkeypatch.setattr(telegram_service, "send", fake_send)
    error_log_service._sent.clear()
    from app.core.db import AsyncSessionLocal

    async def wipe():
        async with AsyncSessionLocal() as s:
            await s.execute(delete(ErrorLog))
            await s.commit()

    await wipe()
    yield sent
    if error_log_service._tasks:
        await asyncio.gather(*list(error_log_service._tasks), return_exceptions=True)
    root = logging.getLogger()
    for h in [h for h in root.handlers if isinstance(h, error_log_service.LogHandler)]:
        root.removeHandler(h)  # other tests must not feed the log
    await wipe()


async def rows(db):
    await db.rollback()
    return (await db.execute(select(ErrorLog).order_by(ErrorLog.created_at))).scalars().all()


async def test_an_error_is_stored_and_sent_to_telegram_once_even_when_it_repeats(db, clean_log):
    for i in range(3):
        await error_log_service.record_now("ai", f"Gemini rejected the request ({400 + i})", "boom", where="ai_service")
    got = await rows(db)
    assert len(got) == 1 and got[0].count == 3 and got[0].source == "ai" and got[0].level == "error"
    assert len(clean_log) == 1 and clean_log[0][0] == "ai"  # the AI topic
    assert "Gemini rejected" in clean_log[0][1]


async def test_a_warning_is_kept_but_not_sent(db, clean_log):
    await error_log_service.record_now("tmdb", "TMDB is slow", level="warning")
    got = await rows(db)
    assert len(got) == 1 and got[0].level == "warning" and clean_log == []


async def test_different_problems_are_separate_entries(db, clean_log):
    await error_log_service.record_now("server", "Disk full")
    await error_log_service.record_now("resolver", "Video service unreachable")
    assert len(await rows(db)) == 2 and len(clean_log) == 2


async def test_a_burst_is_capped_on_telegram_but_all_is_logged(db, clean_log):
    for i in range(error_log_service.BURST[0] + 5):
        await error_log_service.record_now("server", f"Problem kind {chr(65 + i)}")
    assert len(clean_log) == error_log_service.BURST[0]
    assert len(await rows(db)) == error_log_service.BURST[0] + 5


async def test_errors_in_the_application_logs_end_up_in_the_log(db, clean_log):
    error_log_service.install_log_handler()
    logging.getLogger("app.services.ai_service").error("Gemini rejected the request (%s): %s", 403, "key invalid")
    logging.getLogger("app.services.opensubtitles_service").warning("OpenSubtitles login request failed: %s", "timeout")
    logging.getLogger("somebody.else").error("not ours")
    await asyncio.sleep(0.3)
    got = await rows(db)
    assert {(r.source, r.level) for r in got} == {("ai", "error"), ("subtitles", "warning")}
    assert any("key invalid" in r.title for r in got)


async def test_a_log_line_can_opt_out(db, clean_log):
    error_log_service.install_log_handler()
    logging.getLogger("app.services.subtitle_sync_service").error("reported elsewhere", extra={"skip_errorlog": True})
    await asyncio.sleep(0.2)
    assert await rows(db) == []


async def test_an_exception_gets_its_traceback_stored(db, clean_log):
    error_log_service.install_log_handler()
    try:
        1 / 0
    except ZeroDivisionError:
        logging.getLogger("app.services.watch_ai_service").exception("The assistant crashed")
    await asyncio.sleep(0.3)
    got = await rows(db)
    assert got and "ZeroDivisionError" in got[0].title and "Traceback" in got[0].detail and got[0].source == "ai"


async def test_admin_only_endpoints(client, db):
    assert (await client.get("/api/admin/errors")).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        assert (await client.get("/api/admin/errors")).status_code == 403
        assert (await client.get("/api/admin/system/host")).status_code == 403
        assert (await client.post("/api/admin/errors/handle-all")).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_admin_lists_filters_handles_and_clears(client, db):
    await error_log_service.record_now("ai", "AI one")
    await error_log_service.record_now("resolver", "Resolver one", level="warning")
    await error_log_service.record_now("server", "Server one")
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, atoken)
        page = (await client.get("/api/admin/errors")).json()
        assert page["total"] == 3 and page["unhandled"] == 3 and page["last_24h"] == 3
        assert page["by_source"] == {"ai": 1, "resolver": 1, "server": 1}
        assert [i["title"] for i in (await client.get("/api/admin/errors", params={"source": "ai"})).json()["items"]] == ["AI one"]
        assert (await client.get("/api/admin/errors", params={"level": "warning"})).json()["total"] == 1
        assert (await client.get("/api/admin/errors", params={"q": "Server"})).json()["total"] == 1
        first = page["items"][0]
        done = (await client.post(f"/api/admin/errors/{first['id']}/handled")).json()
        assert done["handled"] is True
        after = (await client.get("/api/admin/errors", params={"handled": False})).json()
        assert after["total"] == 2 and after["unhandled"] == 2
        assert (await client.post("/api/admin/errors/handle-all")).json()["changed"] == 2
        assert (await client.post("/api/admin/errors/clear-handled")).json()["cleared"] == 3
        assert (await client.get("/api/admin/errors")).json()["total"] == 0
    finally:
        await _cleanup(db, aname)


async def test_a_browser_can_report_a_problem_with_a_limit(client, db, clean_log):
    assert (await client.post("/api/client-errors", json={"message": "x"})).status_code == 401
    user, name, token = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, token)
        r = await client.post("/api/client-errors", json={"message": "Cannot read x", "page": "/watch/movie/1", "kind": "player"})
        assert r.status_code == 202
        assert (await client.post("/api/client-errors", json={"message": "m", "kind": "weird"})).status_code == 422
        as_(client, atoken)
        item = (await client.get("/api/admin/errors")).json()["items"][0]
        assert item["source"] == "browser" and item["title"].startswith("Video player problem") and item["where"] == "/watch/movie/1" and item["user_name"]
        assert clean_log and clean_log[0][0] == "errors"
        as_(client, token)
        results = [(await client.post("/api/client-errors", json={"message": f"m{i}"})).json()["ok"] for i in range(35)]
        assert results.count(False) >= 5  # past the hourly limit nothing more is stored
    finally:
        await _cleanup(db, name)
        await _cleanup(db, aname)


async def test_a_five_hundred_the_code_raises_is_logged_once(client, db, clean_log):
    from fastapi import HTTPException

    from app.main import app

    @app.get("/api/_boom502")
    async def boom():
        raise HTTPException(502, "The video service isn't available right now.")

    try:
        r = await client.get("/api/_boom502")
    finally:
        app.router.routes[:] = [x for x in app.router.routes if getattr(x, "path", "") != "/api/_boom502"]  # not for other tests
    assert r.status_code == 502 and r.json()["detail"].startswith("The video service")
    await asyncio.sleep(0.3)
    got = await rows(db)
    assert len(got) == 1 and got[0].title.startswith("502") and got[0].where == "GET /api/_boom502"


async def test_an_unhandled_crash_is_logged_with_its_traceback(db, clean_log):
    import httpx
    from fastapi import APIRouter

    from app.main import app

    @app.get("/api/_crash")
    async def crash():
        raise RuntimeError("kaput")

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://t") as c:
            r = await c.get("/api/_crash")
    finally:
        app.router.routes[:] = [x for x in app.router.routes if getattr(x, "path", "") != "/api/_crash"]
    assert r.status_code == 500
    got = await rows(db)
    assert len(got) == 1 and "RuntimeError: kaput" in got[0].title and "Traceback" in got[0].detail


async def test_server_status_numbers(client, db):
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, atoken)
        r = await client.get("/api/admin/system/host")
        assert r.status_code == 200
        d = r.json()
        assert d["disks"] and d["disks"][0]["total"] > 0 and d["disks"][0]["free"] >= 0
        assert d["uptime"]["app_seconds"] >= 0
        assert d["database"]["bytes"] > 0 and d["database"]["connections"] >= 1
        assert d["redis"]["keys"] >= 0
        assert isinstance(d["folders"], list) and len(d["folders"]) == 3
        assert d["watching_now"] >= 0
        if d["memory"]:
            assert d["memory"]["total"] > 0 and d["memory"]["used"] <= d["memory"]["total"]
    finally:
        await _cleanup(db, aname)
