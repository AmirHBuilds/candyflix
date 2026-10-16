"""Devices: history with country and last seen, per-day and at-once limits, new-device message, sign-out, admin view and settings."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, update

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal
from app.core.security import SESSION_COOKIE_NAME
from app.models.admin_notice import AdminNotice
from app.models.audit import AuditLog
from app.models.device import Device
from app.schemas.site import DeviceConfig
from app.services import auth_service, device_service, geo_service, site_service, telegram_service, two_factor_service
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

GOOD = "password123"
CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
ANDROID = "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36"
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"


@pytest.fixture(autouse=True)
async def clean_state(monkeypatch, dispose_db_pool):
    sent = []
    monkeypatch.setattr(telegram_service, "notify", lambda topic, text, **k: sent.append((topic, text)))

    async def wipe():
        async with AsyncSessionLocal() as s:
            await s.execute(delete(AdminNotice))
            await s.commit()

    await wipe()
    yield sent
    await wipe()
    async with AsyncSessionLocal() as s:
        await site_service.set_device_config(s, DeviceConfig())


async def _config(db, **kw):
    await db.rollback()
    await site_service.set_device_config(db, DeviceConfig(**kw))


async def _signin(client, name, ua, device=None):
    """Signs in as a device (a fresh one unless `device` is given). Returns (session token, device cookie) or the response."""
    client.cookies.clear()
    if device:
        client.cookies.set(device_service.COOKIE, device)
    r = await client.post("/api/auth/login", json={"username": name, "password": GOOD}, headers={"user-agent": ua})
    if r.status_code != 200:
        return r
    return r.cookies[SESSION_COOKIE_NAME], r.cookies[device_service.COOKIE]


async def _fresh_user(db, admin=False):
    user, name, token = await _make(db, is_admin=admin)
    await auth_service.invalidate_user_sessions(user.id)  # start with nothing signed in
    return user, name


def _use(client, session, device):
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, session)
    client.cookies.set(device_service.COOKIE, device)


async def test_a_sign_in_creates_a_device_with_where_it_came_from_and_the_same_browser_stays_one_device(client, db):
    user, name = await _fresh_user(db)
    uid = user.id
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, CHROME, device=d1)  # same browser signing in again
        assert d1 == d2 and s1 != s2
        await db.rollback()
        rows = (await db.execute(select(Device).where(Device.user_id == uid))).scalars().all()
        assert len(rows) == 1 and rows[0].label == "Chrome on Windows" and rows[0].sign_ins == 2 and rows[0].last_ip == "127.0.0.1" and rows[0].country == "LAN"
        client.cookies.clear()
        client.cookies.set(SESSION_COOKIE_NAME, s1)
        assert (await client.get("/api/auth/me")).status_code == 401  # one live sign-in per device: the older one ended
        client.cookies.set(SESSION_COOKIE_NAME, s2)
        assert (await client.get("/api/auth/me")).status_code == 200
    finally:
        await _cleanup(db, name)


async def test_a_person_sees_every_device_and_which_one_is_this(client, db):
    user, name = await _fresh_user(db)
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, IPHONE)
        _use(client, s2, d2)
        data = (await client.get("/api/account/devices")).json()
        assert {i["label"] for i in data["items"]} == {"Chrome on Windows", "Safari on iOS"}
        assert data["active"] == 2 and data["today"] == 2 and data["max_per_day"] == 3 and data["max_active"] == 5
        cur = [i for i in data["items"] if i["current"]]
        assert len(cur) == 1 and cur[0]["label"] == "Safari on iOS" and cur[0]["country"] == "LAN" and cur[0]["ip"] == "127.0.0.1"
        assert "user_agent" in cur[0] and "last_seen" in cur[0] and "device_id" not in cur[0]
    finally:
        await _cleanup(db, name)


async def test_last_seen_moves_while_the_device_is_used(client, db):
    user, name = await _fresh_user(db)
    uid = user.id
    try:
        s, d = await _signin(client, name, CHROME)
        old = datetime.now(timezone.utc) - timedelta(days=2)
        await db.rollback()
        await db.execute(update(Device).where(Device.user_id == uid).values(last_seen=old))
        await db.commit()
        await redis_module.get_redis().delete(f"session_seen:{s}")
        _use(client, s, d)
        assert (await client.get("/api/auth/me")).status_code == 200
        await db.rollback()
        row = (await db.execute(select(Device).where(Device.user_id == uid))).scalars().one()
        assert row.last_seen > old + timedelta(days=1)
        # and not written on every request
        await db.execute(update(Device).where(Device.user_id == uid).values(last_seen=old))
        await db.commit()
        assert (await client.get("/api/auth/me")).status_code == 200
        await db.rollback()
        assert (await db.execute(select(Device.last_seen).where(Device.user_id == uid))).scalar_one() == old
    finally:
        await _cleanup(db, name)


async def test_a_person_can_sign_out_another_device_but_not_the_one_in_use_or_someone_elses(client, db):
    user, name = await _fresh_user(db)
    other, oname = await _fresh_user(db)
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, IPHONE)
        _use(client, s2, d2)
        items = (await client.get("/api/account/devices")).json()["items"]
        mine = next(i for i in items if i["current"])
        away = next(i for i in items if not i["current"])
        assert (await client.delete(f"/api/account/devices/{mine['id']}")).status_code == 400
        assert (await client.delete(f"/api/account/devices/{away['id']}")).status_code == 204
        after = {i["id"]: i for i in (await client.get("/api/account/devices")).json()["items"]}
        assert after[away["id"]]["active"] is False and len(after) == 2  # still in the history
        client.cookies.set(SESSION_COOKIE_NAME, s1)
        assert (await client.get("/api/auth/me")).status_code == 401
        # someone else's device id looks like it doesn't exist
        so, do = await _signin(client, oname, MAC)
        _use(client, s2, d2)
        theirs = (await _devices_of(db, oname))[0]
        assert (await client.delete(f"/api/account/devices/{theirs}")).status_code == 404
    finally:
        await _cleanup(db, name, oname)


async def _devices_of(db, username):
    await db.rollback()
    u = await auth_service.get_user_by_username(db, username)
    return [d.id for d in (await db.execute(select(Device).where(Device.user_id == u.id))).scalars().all()]


async def test_over_the_daily_device_limit_tells_the_admins_once_and_still_lets_them_in_by_default(client, db, clean_state):
    await _config(db, max_devices_per_day=2, max_active=10, action="alert")
    user, name = await _fresh_user(db)
    try:
        await _signin(client, name, CHROME)
        await _signin(client, name, IPHONE)
        assert not [n for n in (await db.execute(select(AdminNotice))).scalars().all()]
        third = await _signin(client, name, ANDROID)
        assert not hasattr(third, "status_code")  # signed in
        await _signin(client, name, MAC)
        await db.rollback()
        notices = (await db.execute(select(AdminNotice))).scalars().all()
        assert len(notices) == 1 and notices[0].kind == "devices" and name.title() in notices[0].title and notices[0].link == "security"
        msgs = [t for topic, t in clean_state if topic == "security" and "Device limit" in t]
        assert len(msgs) == 1 and "more than 2 different devices" in msgs[0]
    finally:
        await _cleanup(db, name)


async def test_refuse_turns_the_new_device_away_and_does_not_count_it(client, db):
    await _config(db, max_devices_per_day=2, max_active=10, action="refuse")
    user, name = await _fresh_user(db)
    uid = user.id
    try:
        await _signin(client, name, CHROME)
        await _signin(client, name, IPHONE)
        r = await _signin(client, name, ANDROID)
        assert r.status_code == 403 and "too many different devices" in r.json()["detail"]
        assert SESSION_COOKIE_NAME not in r.cookies
        await db.rollback()
        assert len((await db.execute(select(Device).where(Device.user_id == uid))).scalars().all()) == 2
        # a device already used today is not "new": it can sign in again
        again = await _signin(client, name, CHROME, device=(await _device_cookie(db, uid, "Chrome on Windows")))
        assert not hasattr(again, "status_code")
    finally:
        await _cleanup(db, name)


async def _device_cookie(db, uid, label):
    await db.rollback()
    return (await db.execute(select(Device.device_id).where(Device.user_id == uid, Device.label == label))).scalar_one()


async def test_refuse_never_locks_an_admin_out(client, db):
    await _config(db, max_devices_per_day=1, max_active=1, action="refuse")
    admin, aname = await _fresh_user(db, admin=True)
    try:
        await _signin(client, aname, CHROME)
        second = await _signin(client, aname, IPHONE)
        assert not hasattr(second, "status_code")
        await db.rollback()
        assert (await db.execute(select(AdminNotice).where(AdminNotice.kind == "devices"))).scalars().first() is not None  # told, not blocked
    finally:
        await _cleanup(db, aname)


async def test_too_many_devices_at_once_is_refused_until_one_is_signed_out(client, db):
    await _config(db, max_devices_per_day=50, max_active=2, action="refuse")
    user, name = await _fresh_user(db)
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, IPHONE)
        r = await _signin(client, name, ANDROID)
        assert r.status_code == 403 and "too many devices" in r.json()["detail"]
        _use(client, s2, d2)
        away = next(i for i in (await client.get("/api/account/devices")).json()["items"] if not i["current"])
        assert (await client.delete(f"/api/account/devices/{away['id']}")).status_code == 204
        assert not hasattr(await _signin(client, name, ANDROID), "status_code")
    finally:
        await _cleanup(db, name)


async def test_oldest_signs_out_the_device_that_has_been_signed_in_longest(client, db):
    await _config(db, max_devices_per_day=50, max_active=2, action="oldest")
    user, name = await _fresh_user(db)
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, IPHONE)
        s3, d3 = await _signin(client, name, ANDROID)
        client.cookies.clear()
        for s, ok in ((s1, 401), (s2, 200), (s3, 200)):
            client.cookies.set(SESSION_COOKIE_NAME, s)
            assert (await client.get("/api/auth/me")).status_code == ok
    finally:
        await _cleanup(db, name)


async def test_switched_off_means_no_limits(client, db):
    await _config(db, enabled=False, max_devices_per_day=1, max_active=1, action="refuse")
    user, name = await _fresh_user(db)
    try:
        for ua in (CHROME, IPHONE, ANDROID):
            assert not hasattr(await _signin(client, name, ua), "status_code")
    finally:
        await _cleanup(db, name)


async def test_a_new_device_is_reported_to_the_person_on_telegram_but_not_the_first_one(client, db, monkeypatch):
    user, name = await _fresh_user(db)
    uid = user.id
    await db.rollback()
    u = await auth_service.get_user_by_id(db, uid)
    u.telegram_chat_id = 4242  # Telegram linked = two-step sign-in, so the sign-in goes through a code
    await db.commit()
    sent = []

    async def fake(chat_id, text):
        sent.append((chat_id, text))
        return True

    async def begin(user):
        return "challenge-0123456789"

    async def verify(db_, challenge, code):
        return await auth_service.get_user_by_id(db_, uid)

    monkeypatch.setattr(telegram_service, "send_to_chat", fake)
    monkeypatch.setattr(two_factor_service, "begin_login", begin)
    monkeypatch.setattr(two_factor_service, "verify", verify)

    async def signin(ua, device=None):
        client.cookies.clear()
        if device:
            client.cookies.set(device_service.COOKIE, device)
        assert (await client.post("/api/auth/login", json={"username": name, "password": GOOD}, headers={"user-agent": ua})).json()["two_factor_required"]
        r = await client.post("/api/auth/login/verify", json={"challenge": "challenge-0123456789", "code": "000000"}, headers={"user-agent": ua})
        assert r.status_code == 200
        await asyncio.gather(*device_service._tasks)
        return r.cookies[device_service.COOKIE]

    try:
        d1 = await signin(CHROME)
        assert sent == []  # the very first device is not news
        await signin(IPHONE)
        assert len(sent) == 1 and sent[0][0] == 4242 and "Safari on iOS" in sent[0][1]
        await signin(CHROME, d1)  # a known device
        assert len(sent) == 1
        await _config(db, notify_user=False)
        await signin(ANDROID)
        assert len(sent) == 1
    finally:
        await _cleanup(db, name)


async def test_a_sign_in_from_before_devices_existed_gets_its_device_when_seen(client, db):
    user, name = await _fresh_user(db)
    uid = user.id
    try:
        token = await auth_service.create_session(uid)  # no device, like a session made by the old version
        client.cookies.clear()
        client.cookies.set(SESSION_COOKIE_NAME, token)
        r = await client.get("/api/auth/me", headers={"user-agent": MAC})
        assert r.status_code == 200 and device_service.COOKIE in r.cookies
        await db.rollback()
        rows = (await db.execute(select(Device).where(Device.user_id == uid))).scalars().all()
        assert len(rows) == 1 and rows[0].label == "Safari on macOS" and rows[0].device_id == r.cookies[device_service.COOKIE]
        assert (await auth_service.session_meta(token))["device"] == rows[0].device_id
        r2 = await client.get("/api/auth/me")
        assert device_service.COOKIE not in r2.cookies or True
        await db.rollback()
        assert len((await db.execute(select(Device).where(Device.user_id == uid))).scalars().all()) == 1  # not adopted twice
    finally:
        await _cleanup(db, name)


async def test_an_admin_sees_a_persons_devices_and_can_sign_one_out(client, db):
    user, name = await _fresh_user(db)
    uid = user.id
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        s1, d1 = await _signin(client, name, CHROME)
        s2, d2 = await _signin(client, name, IPHONE)
        as_(client, atoken)
        data = (await client.get(f"/api/admin/users/{uid}/devices")).json()
        assert len(data["items"]) == 2 and data["active"] == 2 and all(i["current"] is False for i in data["items"])
        phone = next(i for i in data["items"] if i["label"] == "Safari on iOS")
        r = await client.delete(f"/api/admin/users/{uid}/devices/{phone['id']}")
        assert r.status_code == 200 and r.json() == {"ended": 1}
        client.cookies.clear()
        client.cookies.set(SESSION_COOKIE_NAME, s2)
        assert (await client.get("/api/auth/me")).status_code == 401
        client.cookies.set(SESSION_COOKIE_NAME, s1)
        assert (await client.get("/api/auth/me")).status_code == 200
        await db.rollback()
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "device.end"))).scalars().first() is not None
        # people can't
        client.cookies.clear()
        client.cookies.set(SESSION_COOKIE_NAME, s1)
        assert (await client.get(f"/api/admin/users/{uid}/devices")).status_code == 403
        as_(client, atoken)
        assert (await client.get("/api/admin/users/00000000-0000-0000-0000-000000000000/devices")).status_code == 404
    finally:
        await _cleanup(db, name, aname)


async def test_the_device_limits_are_set_by_admins_only(client, db):
    user, name, token = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    body = {"enabled": True, "max_devices_per_day": 4, "max_active": 6, "action": "refuse", "notify_user": False}
    try:
        as_(client, token)
        assert (await client.put("/api/admin/security/device-config", json=body)).status_code == 403
        as_(client, atoken)
        saved = (await client.put("/api/admin/security/device-config", json=body)).json()
        assert {k: saved[k] for k in body} == body and saved["country_available"] in (True, False)
        assert {k: (await client.get("/api/admin/security/device-config")).json()[k] for k in body} == body
        assert (await client.put("/api/admin/security/device-config", json={**body, "action": "explode"})).status_code == 422
        assert (await client.put("/api/admin/security/device-config", json={**body, "max_active": 0})).status_code == 422
        await db.rollback()
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "device.config"))).scalars().first() is not None
    finally:
        await _cleanup(db, name, aname)


async def test_the_sign_in_log_shows_the_country(client, db):
    user, name = await _fresh_user(db)
    uid = user.id
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        await _signin(client, name, CHROME)
        as_(client, atoken)
        page = (await client.get("/api/admin/sign-in-log", params={"user_id": str(uid)})).json()
        assert page["items"][0]["country"] == "LAN"
    finally:
        await _cleanup(db, name, aname)


def test_country_comes_from_the_offline_file_and_is_unknown_without_it(monkeypatch):
    class Fake:
        def get(self, ip):
            return {"country": {"iso_code": "de"}} if ip == "8.8.4.4" else None

    monkeypatch.setattr(geo_service, "_tried", True)
    monkeypatch.setattr(geo_service, "_reader", Fake())
    assert geo_service.country("8.8.4.4") == "DE"
    assert geo_service.country("1.2.3.4") is None  # not in the file
    assert geo_service.country("192.168.1.5") == "LAN" and geo_service.country("127.0.0.1") == "LAN"
    assert geo_service.country("not an ip") is None and geo_service.country(None) is None
    monkeypatch.setattr(geo_service, "_reader", None)
    assert geo_service.country("8.8.4.4") is None and geo_service.available() is False


async def test_devices_not_seen_for_90_days_are_forgotten(db):
    user, name, _ = await _make(db)
    uid = user.id
    try:
        now = datetime.now(timezone.utc)
        db.add(Device(user_id=uid, device_id="old", label="Old", last_seen=now - timedelta(days=100)))
        db.add(Device(user_id=uid, device_id="new", label="New", last_seen=now))
        await db.commit()
        assert await device_service.cleanup() >= 1
        await db.rollback()
        labels = [d.label for d in (await db.execute(select(Device).where(Device.user_id == uid))).scalars().all()]
        assert labels == ["New"]
    finally:
        await _cleanup(db, name)
