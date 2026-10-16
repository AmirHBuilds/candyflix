"""Sign-in addresses, account-sharing alerts, and the admins' notices with rest mode."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.models.admin_notice import AdminNotice, AdminPref
from app.models.audit import SignInLog
from app.services import audit_service, notice_service, site_service, telegram_service
from app.schemas.site import SharingConfig
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

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


@pytest.fixture(autouse=True)
async def clean_notices(monkeypatch, dispose_db_pool):
    sent = []
    monkeypatch.setattr(telegram_service, "notify", lambda topic, text, **k: sent.append((topic, text)))
    from app.core.db import AsyncSessionLocal

    async def wipe():
        async with AsyncSessionLocal() as s:
            await s.execute(delete(AdminNotice))
            await s.commit()

    await wipe()
    yield sent
    await wipe()


async def _settings(db, **kw):
    await db.rollback()
    await site_service.set_sharing_config(db, SharingConfig(**kw))


async def test_a_sign_in_records_where_it_came_from(client, db):
    user, name, token = await _make(db)
    uid = user.id
    try:
        r = await client.post("/api/auth/login", json={"username": name, "password": "password123"}, headers={"user-agent": UA})
        assert r.status_code == 200
        await db.rollback()
        row = (await db.execute(select(SignInLog).where(SignInLog.user_id == uid))).scalars().one()
        assert row.ip and row.user_agent == UA
        admin, aname, atoken = await _make(db, is_admin=True)
        try:
            as_(client, atoken)
            page = (await client.get("/api/admin/sign-in-log", params={"user_id": str(uid)})).json()
            assert page["items"][0]["ip"] == row.ip and page["items"][0]["device"] == "Chrome on Windows" and page["items"][0]["user_agent"] == UA
        finally:
            await _cleanup(db, aname)
    finally:
        await _cleanup(db, name)


async def test_many_addresses_in_a_short_time_tell_the_admins_once(db, clean_notices):
    await _settings(db, enabled=True, max_ips=4, window_hours=24)
    user, name, _ = await _make(db)
    try:
        for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
            await audit_service.record_sign_in(db, user, UA, ip)
        assert (await db.execute(select(AdminNotice))).scalars().all() == []  # three is still normal
        await audit_service.record_sign_in(db, user, UA, "4.4.4.4")
        notices = (await db.execute(select(AdminNotice))).scalars().all()
        assert len(notices) == 1 and notices[0].kind == "sharing" and "4 different addresses" in notices[0].title and notices[0].link == "security"
        assert [t for t, _ in clean_notices if t == "security"] and "4.4.4.4" in clean_notices[-1][1]
        await audit_service.record_sign_in(db, user, UA, "5.5.5.5")
        assert len((await db.execute(select(AdminNotice))).scalars().all()) == 1  # not again within 12 hours
        for ip in ("1.1.1.1", "1.1.1.1", "1.1.1.1"):
            await audit_service.record_sign_in(db, user, UA, ip)  # the same address again and again is not sharing
    finally:
        await _cleanup(db, name)


async def test_old_sign_ins_and_a_switched_off_check_do_not_count(db):
    user, name, _ = await _make(db)
    uid = user.id
    try:
        await _settings(db, enabled=True, max_ips=3, window_hours=24)
        old = datetime.now(timezone.utc) - timedelta(days=3)
        for ip in ("1.1.1.1", "2.2.2.2"):
            db.add(SignInLog(user_id=uid, user_agent=UA, ip=ip, at=old))
        await db.commit()
        await db.refresh(user)
        await audit_service.record_sign_in(db, user, UA, "3.3.3.3")
        assert (await db.execute(select(AdminNotice))).scalars().all() == []
        await _settings(db, enabled=False, max_ips=2, window_hours=24)
        await db.refresh(user)
        for ip in ("4.4.4.4", "5.5.5.5", "6.6.6.6"):
            await audit_service.record_sign_in(db, user, UA, ip)
        assert (await db.execute(select(AdminNotice))).scalars().all() == []
    finally:
        await _settings(db, enabled=True, max_ips=4, window_hours=24)
        await _cleanup(db, name)


async def test_the_overview_lists_who_and_which_addresses(client, db):
    await _settings(db, enabled=True, max_ips=3, window_hours=24)
    shared, sname, _ = await _make(db)
    calm, cname, _ = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3", "1.1.1.1"):
            await audit_service.record_sign_in(db, shared, UA, ip)
        await audit_service.record_sign_in(db, calm, UA, "9.9.9.9")
        as_(client, atoken)
        data = (await client.get("/api/admin/security/sharing")).json()
        mine = [p for p in data["people"] if p["username"] == sname]
        assert data["max_ips"] == 3 and data["window_hours"] == 24 and not [p for p in data["people"] if p["username"] == cname]
        assert len(mine) == 1 and mine[0]["flagged"] is True and mine[0]["distinct_ips"] == 3 and mine[0]["sign_ins"] == 4
        by_ip = {i["ip"]: i for i in mine[0]["ips"]}
        assert by_ip["1.1.1.1"]["sign_ins"] == 2 and by_ip["1.1.1.1"]["devices"] == ["Chrome on Windows"]
    finally:
        await _settings(db, enabled=True, max_ips=4, window_hours=24)
        await _cleanup(db, sname, cname, aname)


async def test_the_limits_can_be_changed_and_are_audited(client, db):
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, atoken)
        r = await client.put("/api/admin/security/sharing-config", json={"enabled": True, "max_ips": 6, "window_hours": 48})
        assert r.status_code == 200 and (await client.get("/api/admin/security/sharing-config")).json() == {"enabled": True, "max_ips": 6, "window_hours": 48}
        assert (await client.put("/api/admin/security/sharing-config", json={"enabled": True, "max_ips": 1, "window_hours": 24})).status_code == 422
    finally:
        await _settings(db, enabled=True, max_ips=4, window_hours=24)
        await _cleanup(db, aname)


async def test_security_and_notices_are_for_admins(client, db):
    paths = [("get", "/api/admin/security/sharing"), ("get", "/api/admin/notices"), ("post", "/api/admin/notices/read"), ("put", "/api/admin/notices/rest")]
    for m, p in paths:
        assert (await getattr(client, m)(p)).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        for m, p in paths:
            assert (await getattr(client, m)(p)).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_feedback_becomes_a_notice_that_each_admin_reads_for_themselves(client, db):
    writer, wname, wtoken = await _make(db)
    a1, n1, t1 = await _make(db, is_admin=True)
    a2, n2, t2 = await _make(db, is_admin=True)
    try:
        as_(client, wtoken)
        assert (await client.post("/api/feedback", json={"kind": "problem", "message": "The subtitles are early"})).status_code == 201
        as_(client, t1)
        got = (await client.get("/api/admin/notices")).json()
        assert got["unread"] == 1 and got["items"][0]["kind"] == "feedback" and got["items"][0]["unread"] is True
        assert "a problem" in got["items"][0]["title"] and got["items"][0]["link"] == "feedback" and "subtitles" in got["items"][0]["body"]
        assert (await client.post("/api/admin/notices/read")).status_code == 204
        again = (await client.get("/api/admin/notices")).json()
        assert again["unread"] == 0 and again["items"][0]["unread"] is False
        as_(client, t2)
        assert (await client.get("/api/admin/notices")).json()["unread"] == 1  # the other admin has not read it
    finally:
        await _cleanup(db, wname, n1, n2)


async def test_rest_mode(client, db):
    admin, aname, token = await _make(db, is_admin=True)
    aid = admin.id
    other, oname, otoken = await _make(db, is_admin=True)
    try:
        as_(client, token)
        assert (await client.get("/api/admin/notices")).json()["resting"] is False
        r = (await client.put("/api/admin/notices/rest", json={"minutes": 60})).json()
        assert r["resting"] is True and r["rest_forever"] is False and r["rest_until"]
        until = datetime.fromisoformat(r["rest_until"])
        assert timedelta(minutes=58) < until - datetime.now(timezone.utc) < timedelta(minutes=61)
        forever = (await client.put("/api/admin/notices/rest", json={"minutes": None})).json()
        assert forever["resting"] and forever["rest_forever"] and forever["rest_until"] is None
        as_(client, otoken)
        assert (await client.get("/api/admin/notices")).json()["resting"] is False  # it is personal
        as_(client, token)
        off = (await client.put("/api/admin/notices/rest", json={"minutes": 0})).json()
        assert off["resting"] is False and off["rest_forever"] is False
        # a rest that has run out is over
        await db.rollback()
        pref = await db.get(AdminPref, aid)
        pref.rest_until = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db.commit()
        assert (await client.get("/api/admin/notices")).json()["resting"] is False
        assert (await client.put("/api/admin/notices/rest", json={"minutes": -5})).status_code == 422
    finally:
        await _cleanup(db, aname, oname)


async def test_old_notices_are_cleaned_up(db):
    from app.core.db import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        s.add(AdminNotice(kind="feedback", title="old", at=datetime.now(timezone.utc) - timedelta(days=40)))
        s.add(AdminNotice(kind="feedback", title="new"))
        await s.commit()
    assert await notice_service.cleanup() == 1
    await db.rollback()
    assert [n.title for n in (await db.execute(select(AdminNotice))).scalars().all()] == ["new"]
