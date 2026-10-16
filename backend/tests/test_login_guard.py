"""Limits on wrong passwords, the record of them, and the other sign-in protections (devices, sign-out, password rule)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

import app.core.redis as redis_module
from app.core import password_policy
from app.core.db import AsyncSessionLocal
from app.core.security import SESSION_COOKIE_NAME
from app.models.admin_notice import AdminNotice
from app.models.audit import AuditLog, SignInLog
from app.models.login_event import LoginEvent
from app.schemas.site import LoginGuardConfig
from app.services import auth_service, login_guard_service, site_service, telegram_service
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

GOOD = "password123"  # what _make gives everyone; fine for signing in (the password rule only applies to new passwords)


@pytest.fixture(autouse=True)
async def clean_state(monkeypatch, dispose_db_pool):
    sent = []
    monkeypatch.setattr(telegram_service, "notify", lambda topic, text, **k: sent.append((topic, text)))

    async def wipe():
        async with AsyncSessionLocal() as s:
            await s.execute(delete(AdminNotice))
            await s.execute(delete(LoginEvent))
            await s.commit()

    await wipe()
    yield sent
    await login_guard_service.cleanup()
    await wipe()


async def _config(db, **kw):
    await db.rollback()
    await site_service.set_login_guard_config(db, LoginGuardConfig(**kw))


async def _login(client, name, password):
    return await client.post("/api/auth/login", json={"username": name, "password": password})


async def _wrong(client, name, times):
    codes = []
    for _ in range(times):
        codes.append((await _login(client, name, "nope-nope")).status_code)
    return codes


async def test_five_wrong_passwords_block_that_name_even_for_the_right_password(client, db):
    await _config(db)
    user, name, _ = await _make(db)
    try:
        assert await _wrong(client, name, 5) == [401] * 5
        r = await _login(client, name, GOOD)
        assert r.status_code == 429
        assert "Too many tries" in r.json()["detail"] and int(r.headers["retry-after"]) > 0
        assert (await _login(client, name.upper(), GOOD)).status_code == 429  # upper case is the same name
    finally:
        await _cleanup(db, name)


async def test_the_block_says_the_same_for_a_wrong_password_and_a_right_one(client, db):
    await _config(db)
    user, name, _ = await _make(db)
    try:
        await _wrong(client, name, 5)
        a = await _login(client, name, GOOD)
        b = await _login(client, name, "something else")
        assert a.status_code == b.status_code == 429 and a.json()["detail"] == b.json()["detail"]
    finally:
        await _cleanup(db, name)


async def test_other_names_are_not_affected_by_one_names_block(client, db):
    await _config(db, name_failures=3, ip_failures=100)
    one, n1, _ = await _make(db)
    two, n2, _ = await _make(db)
    try:
        await _wrong(client, n1, 3)
        assert (await _login(client, n1, GOOD)).status_code == 429
        assert (await _login(client, n2, GOOD)).status_code == 200
    finally:
        await _cleanup(db, n1, n2)


async def test_one_address_trying_many_names_is_blocked_whatever_the_name(client, db):
    await _config(db, name_failures=50, ip_failures=4)
    user, name, _ = await _make(db)
    try:
        for i in range(4):
            assert (await _login(client, f"nobody{i}", "x")).status_code == 401
        assert (await _login(client, name, GOOD)).status_code == 429  # a real name with the right password, still blocked
    finally:
        await _cleanup(db, name)


async def test_a_right_password_clears_the_run_of_wrong_ones(client, db):
    await _config(db)
    user, name, _ = await _make(db)
    try:
        await _wrong(client, name, 4)
        assert (await _login(client, name, GOOD)).status_code == 200
        assert await _wrong(client, name, 4) == [401] * 4  # not blocked: the count started again
    finally:
        await _cleanup(db, name)


async def test_an_address_the_person_already_signed_in_from_gets_past_a_name_block(client, db):
    await _config(db, name_failures=3, ip_failures=100)
    user, name, _ = await _make(db)
    uid = user.id
    try:
        await _wrong(client, name, 3)
        assert (await _login(client, name, GOOD)).status_code == 429
        await db.rollback()
        db.add(SignInLog(user_id=uid, ip="127.0.0.1", user_agent="x"))  # the test client's address, seen before
        await db.commit()
        assert (await _login(client, name, GOOD)).status_code == 200
        assert (await _login(client, name, "wrong")).status_code == 401  # known address, wrong password: just wrong
    finally:
        await _cleanup(db, name)


async def test_a_known_address_does_not_get_past_an_address_block(client, db):
    await _config(db, name_failures=50, ip_failures=3)
    user, name, _ = await _make(db)
    uid = user.id
    try:
        db.add(SignInLog(user_id=uid, ip="127.0.0.1", user_agent="x"))
        await db.commit()
        await _wrong(client, name, 3)
        assert (await _login(client, name, GOOD)).status_code == 429
    finally:
        await _cleanup(db, name)


async def test_switched_off_never_blocks(client, db):
    await _config(db, enabled=False)
    user, name, _ = await _make(db)
    try:
        assert await _wrong(client, name, 8) == [401] * 8
        assert (await _login(client, name, GOOD)).status_code == 200
    finally:
        await _cleanup(db, name)


async def test_the_first_block_goes_to_telegram_and_the_bell_once_and_is_recorded(client, db, clean_state):
    await _config(db, name_failures=3, ip_failures=100)
    user, name, _ = await _make(db)
    try:
        await _wrong(client, name, 3)
        await _login(client, name, GOOD)  # refused tries are not alerts
        await _login(client, name, GOOD)
        blocked_msgs = [t for topic, t in clean_state if topic == "security" and "blocked" in t]
        assert len(blocked_msgs) == 1 and name in blocked_msgs[0] and "3 wrong passwords" in blocked_msgs[0]
        await db.rollback()
        notices = (await db.execute(select(AdminNotice))).scalars().all()
        assert len(notices) == 1 and notices[0].kind == "security" and notices[0].link == "security" and name in notices[0].title
        events = (await db.execute(select(LoginEvent).order_by(LoginEvent.at))).scalars().all()
        assert [e.kind for e in events].count("failed") == 3 and [e.kind for e in events].count("blocked") == 1
        assert all(e.ip == "127.0.0.1" for e in events if e.kind == "failed")
    finally:
        await _cleanup(db, name)


async def test_a_repeat_block_lasts_twice_as_long_and_never_more_than_four_times(db):
    cfg = LoginGuardConfig(name_failures=2, ip_failures=500, window_minutes=15, lockout_minutes=10)
    r = redis_module.get_redis()
    seen = []
    for _ in range(4):
        await login_guard_service.record_failure("repeater", "9.9.9.9", cfg)
        blocks = await login_guard_service.record_failure("repeater", "9.9.9.9", cfg)
        assert len(blocks) == 1
        seen.append(blocks[0].minutes)
        await r.delete("lg:nb:repeater")  # the block ran out; the repeat count stays for a day
    assert seen == [10, 20, 40, 40]


async def test_an_admin_sees_the_blocks_and_can_lift_one(client, db):
    await _config(db, name_failures=3, ip_failures=100)
    user, name, _ = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        await _wrong(client, name, 3)
        as_(client, atoken)
        data = (await client.get("/api/admin/security/logins")).json()
        block = next(b for b in data["blocks"] if b["key"] == name.lower())
        assert block["scope"] == "name" and block["fails"] == 3 and 0 < block["seconds_left"] <= 15 * 60 and block["others"] == ["127.0.0.1"]
        assert any(e["kind"] == "failed" and e["username"] == name for e in data["events"])
        assert any(e["kind"] == "blocked" for e in data["events"])
        client.cookies.clear()
        assert (await _login(client, name, GOOD)).status_code == 429
        as_(client, atoken)
        assert (await client.delete("/api/admin/security/blocks", params={"scope": "name", "key": name})).status_code == 204
        assert (await client.delete("/api/admin/security/blocks", params={"scope": "name", "key": name})).status_code == 404
        client.cookies.clear()
        assert (await _login(client, name, GOOD)).status_code == 200
        await db.rollback()
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "login.unblock"))).scalars().first() is not None
    finally:
        await _cleanup(db, name, aname)


async def test_limits_can_be_changed_by_an_admin_only(client, db):
    user, name, token = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    body = {"enabled": True, "name_failures": 7, "ip_failures": 30, "window_minutes": 10, "lockout_minutes": 20}
    try:
        as_(client, token)
        assert (await client.put("/api/admin/security/login-config", json=body)).status_code == 403
        assert (await client.get("/api/admin/security/logins")).status_code == 403
        as_(client, atoken)
        assert (await client.put("/api/admin/security/login-config", json=body)).json() == body
        assert (await client.get("/api/admin/security/logins")).json()["config"] == body
        assert (await client.put("/api/admin/security/login-config", json={**body, "name_failures": 1})).status_code == 422
        await db.rollback()
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "login.config"))).scalars().first() is not None
    finally:
        await _config(db)
        await _cleanup(db, name, aname)


async def test_the_overview_lists_people_without_two_step_when_it_is_available(client, db, monkeypatch):
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, atoken)
        monkeypatch.setattr(telegram_service, "enabled", lambda: False)
        off = (await client.get("/api/admin/security/logins")).json()
        assert off["two_step_available"] is False and off["without_two_step"] == []
        monkeypatch.setattr(telegram_service, "enabled", lambda: True)
        on = (await client.get("/api/admin/security/logins")).json()
        assert on["two_step_available"] is True and aname in [p["username"] for p in on["without_two_step"]]
    finally:
        await _cleanup(db, aname)


async def test_old_failed_sign_ins_are_forgotten(db):
    async with AsyncSessionLocal() as s:
        s.add(LoginEvent(kind="failed", username="old", ip="1.1.1.1", at=datetime.now(timezone.utc) - timedelta(days=40)))
        s.add(LoginEvent(kind="failed", username="new", ip="1.1.1.1"))
        await s.commit()
    assert await login_guard_service.cleanup() >= 1
    await db.rollback()
    names = [e.username for e in (await db.execute(select(LoginEvent))).scalars().all()]
    assert "old" not in names and "new" in names


# ---------- devices ----------


async def test_a_person_sees_their_devices_and_can_sign_out_the_others(client, db):
    user, name, _ = await _make(db)
    await auth_service.invalidate_user_sessions(user.id)  # start with none; _make signed one in
    try:
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
        phone = await _login_cookie(client, name, ua)
        laptop = await _login_cookie(client, name, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36")
        as_(client, laptop)
        rows = (await client.get("/api/account/sessions")).json()
        assert len(rows) == 2 and [r["current"] for r in rows].count(True) == 1
        assert {r["device"] for r in rows} == {"Safari on iOS", "Chrome on Windows"}
        assert all("token" not in r and phone not in str(r) for r in rows)
        assert (await client.post("/api/account/sessions/sign-out-others")).json() == {"ended": 1}
        client.cookies.set(SESSION_COOKIE_NAME, phone)
        assert (await client.get("/api/auth/me")).status_code == 401
        as_(client, laptop)
        assert (await client.get("/api/auth/me")).status_code == 200
    finally:
        await _cleanup(db, name)


async def test_one_device_can_be_signed_out_but_not_the_one_in_use(client, db):
    user, name, _ = await _make(db)
    await auth_service.invalidate_user_sessions(user.id)
    try:
        other = await _login_cookie(client, name, "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36")
        mine = await _login_cookie(client, name, "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36")
        as_(client, mine)
        rows = (await client.get("/api/account/sessions")).json()
        current = next(r for r in rows if r["current"])
        away = next(r for r in rows if not r["current"])
        assert (await client.delete(f"/api/account/sessions/{current['id']}")).status_code == 400
        assert (await client.delete(f"/api/account/sessions/{away['id']}")).status_code == 204
        assert (await client.delete(f"/api/account/sessions/{away['id']}")).status_code == 404
        client.cookies.set(SESSION_COOKIE_NAME, other)
        assert (await client.get("/api/auth/me")).status_code == 401
    finally:
        await _cleanup(db, name)


async def test_nobody_can_sign_out_someone_elses_device(client, db):
    a, na, ta = await _make(db)
    b, nb, tb = await _make(db)
    try:
        as_(client, tb)
        b_id = (await client.get("/api/account/sessions")).json()[0]["id"]
        as_(client, ta)
        assert (await client.delete(f"/api/account/sessions/{b_id}")).status_code == 404
        as_(client, tb)
        assert (await client.get("/api/auth/me")).status_code == 200
    finally:
        await _cleanup(db, na, nb)


async def test_an_admin_can_sign_a_person_out_everywhere(client, db):
    user, name, token = await _make(db)
    uid = user.id
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        await auth_service.create_session(uid)
        as_(client, atoken)
        r = await client.post(f"/api/admin/users/{uid}/sign-out")
        assert r.status_code == 200 and r.json() == {"ended": 2}
        as_(client, token)
        assert (await client.get("/api/auth/me")).status_code == 401
        as_(client, atoken)
        assert (await client.post(f"/api/admin/users/{uid}/sign-out")).json() == {"ended": 0}
        await db.rollback()
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "user.sign_out"))).scalars().first() is not None
        as_(client, atoken)
        # people can't use it
        client.cookies.clear()
        other, oname, otoken = await _make(db)
        try:
            as_(client, otoken)
            assert (await client.post(f"/api/admin/users/{uid}/sign-out")).status_code == 403
        finally:
            await _cleanup(db, oname)
    finally:
        await _cleanup(db, name, aname)


async def _login_cookie(client, name, ua):
    client.cookies.clear()
    r = await client.post("/api/auth/login", json={"username": name, "password": GOOD}, headers={"user-agent": ua})
    assert r.status_code == 200, r.text
    return r.cookies[SESSION_COOKIE_NAME]


# ---------- password rule ----------


def test_the_password_rule():
    assert password_policy.problem("password123")
    assert password_policy.problem("Password123")  # case doesn't matter
    assert password_policy.problem("12345678")
    assert password_policy.problem("99999999")
    assert password_policy.problem("aaaaabab")
    assert password_policy.problem("candy1234", "candy")
    assert password_policy.problem("Sunflower", "sunflower")
    assert password_policy.problem("correct horse battery") is None
    assert password_policy.problem("T3a-kettle-77") is None


async def test_a_weak_new_password_is_refused_everywhere_it_can_be_set(client, db):
    user, name, token = await _make(db)
    uid = user.id
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, token)
        r = await client.post("/api/account/password", json={"current_password": GOOD, "new_password": "qwerty123"})
        assert r.status_code == 400 and "first ones" in r.json()["detail"]
        assert (await client.post("/api/account/password", json={"current_password": GOOD, "new_password": "Lantern-Moss-42"})).status_code == 204
        as_(client, atoken)
        r = await client.post(f"/api/admin/users/{uid}/password", json={"new_password": "12345678"})
        assert r.status_code == 400
        assert (await client.post(f"/api/admin/users/{uid}/password", json={"new_password": "Harbor-Lamp-19"})).status_code == 204
        made = await client.post("/api/admin/users", json={"username": f"weak_{name[-6:]}", "display_name": "W", "password": "password1", "is_admin": False})
        assert made.status_code == 400
    finally:
        await _cleanup(db, name, aname)
