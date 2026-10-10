import json
import re

import httpx
import pytest
import respx
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import AsyncSessionLocal
from app.core.redis import get_redis
from app.models.user import User
from app.services import two_factor_service as tf

TG = "https://api.telegram.org/botT0KEN/"


@pytest.fixture
def bot(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "telegram_bot_token", "T0KEN")
    monkeypatch.setattr(s, "telegram_chat_id", "-1001")
    monkeypatch.setattr(tf, "_bot_username", "CandyBot")


def sent_codes(route):
    out = []
    for c in route.calls:
        body = json.loads(c.request.content)
        m = re.search(r"<code>(\d{6})</code>", body.get("text", ""))
        if m:
            out.append((body["chat_id"], m.group(1)))
    return out
import uuid

from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clean():
    tf.telegram_service._tasks.clear()
    redis_module._redis_client = None
    redis_module.get_redis()
    yield
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def rid() -> int:
    return uuid.uuid4().int % 10**12


async def make_user(is_admin=False, chat=None):
    name = f"tf_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        u = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin)
        if chat:
            u.telegram_chat_id = chat
            await db.commit()
        return u.id, name


async def as_user(client, uid):
    client.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))


async def test_linking_then_signing_in_needs_the_code(client, bot):
    CHAT = rid()
    uid, name = await make_user()
    await as_user(client, uid)
    with respx.mock(assert_all_called=False) as m:
        m.post(TG + "getUpdates").mock(return_value=httpx.Response(200, json={"ok": True, "result": []}))
        send = m.post(TG + "sendMessage").mock(return_value=httpx.Response(200, json={"ok": True, "result": {}}))

        # a wrong password can't start it
        assert (await client.post("/api/account/2fa/start", json={"password": "nope"})).status_code == 400
        link = (await client.post("/api/account/2fa/start", json={"password": "password123"})).json()["url"]
        assert link.startswith("https://t.me/CandyBot?start=")
        token = link.split("start=")[1]

        # pressing Start in the bot connects the chat; the link works once
        await tf.handle_update({"update_id": 1, "message": {"chat": {"id": CHAT, "type": "private"}, "text": f"/start {token}"}})
        assert (await client.get("/api/account/2fa")).json() == {"available": True, "enabled": True}
        await tf.handle_update({"update_id": 2, "message": {"chat": {"id": CHAT + 1, "type": "private"}, "text": f"/start {token}"}})
        async with AsyncSessionLocal() as db:
            assert (await db.get(User, uid)).telegram_chat_id == CHAT

        # now the password alone does not sign in
        client.cookies.clear()
        res = await client.post("/api/auth/login", json={"username": name, "password": "password123"})
        body = res.json()
        assert body["two_factor_required"] is True and SESSION_COOKIE_NAME not in res.cookies
        (chat, code), = sent_codes(send)
        assert chat == CHAT

        wrong = await client.post("/api/auth/login/verify", json={"challenge": body["challenge"], "code": "000000" if code != "000000" else "111111"})
        assert wrong.status_code == 401
        ok = await client.post("/api/auth/login/verify", json={"challenge": body["challenge"], "code": code})
        assert ok.status_code == 200 and ok.json()["username"] == name
        assert SESSION_COOKIE_NAME in ok.cookies
        # a used code is gone
        assert (await client.post("/api/auth/login/verify", json={"challenge": body["challenge"], "code": code})).status_code == 410


async def test_too_many_wrong_codes_burn_the_challenge(client, bot):
    uid, name = await make_user(chat=rid())
    with respx.mock(assert_all_called=False) as m:
        send = m.post(TG + "sendMessage").mock(return_value=httpx.Response(200, json={"ok": True, "result": {}}))
        ch = (await client.post("/api/auth/login", json={"username": name, "password": "password123"})).json()["challenge"]
        (_, code), = sent_codes(send)
        bad = "123456" if code != "123456" else "654321"
        statuses = [(await client.post("/api/auth/login/verify", json={"challenge": ch, "code": bad})).status_code for _ in range(6)]
        assert statuses[:5] == [401] * 5 and statuses[5] == 429
        assert (await client.post("/api/auth/login/verify", json={"challenge": ch, "code": code})).status_code == 410


async def test_if_telegram_cannot_deliver_nobody_is_signed_in(client, bot):
    uid, name = await make_user(chat=rid())
    with respx.mock(assert_all_called=False) as m:
        m.post(TG + "sendMessage").mock(return_value=httpx.Response(500))
        res = await client.post("/api/auth/login", json={"username": name, "password": "password123"})
    assert res.status_code == 503 and SESSION_COOKIE_NAME not in res.cookies


async def test_resend_waits_a_little(client, bot):
    uid, name = await make_user(chat=rid())
    with respx.mock(assert_all_called=False) as m:
        m.post(TG + "sendMessage").mock(return_value=httpx.Response(200, json={"ok": True, "result": {}}))
        ch = (await client.post("/api/auth/login", json={"username": name, "password": "password123"})).json()["challenge"]
        assert (await client.post("/api/auth/login/resend", json={"challenge": ch})).status_code == 429


async def test_a_person_can_turn_it_off_with_their_password(client, bot):
    uid, name = await make_user(chat=rid())
    await as_user(client, uid)
    assert (await client.post("/api/account/2fa/off", json={"password": "bad"})).status_code == 400
    assert (await client.post("/api/account/2fa/off", json={"password": "password123"})).status_code == 204
    assert (await client.get("/api/account/2fa")).json()["enabled"] is False


async def test_an_admin_sees_and_switches_off_it_for_someone(client, bot):
    aid, _ = await make_user(is_admin=True)
    uid, _ = await make_user(chat=rid())
    await as_user(client, aid)
    users = (await client.get("/api/admin/users")).json()
    assert next(u for u in users if u["id"] == str(uid))["two_factor_enabled"] is True
    assert next(u for u in users if u["id"] == str(aid))["two_factor_enabled"] is False
    res = await client.post(f"/api/admin/users/{uid}/2fa-off")
    assert res.status_code == 200 and res.json()["two_factor_enabled"] is False
    assert (await client.post(f"/api/admin/users/{uid}/2fa-off")).status_code == 400
    # a normal member can't
    other, _ = await make_user()
    await as_user(client, other)
    assert (await client.post(f"/api/admin/users/{uid}/2fa-off")).status_code == 403


async def test_without_a_bot_it_is_unavailable(client):
    uid, _ = await make_user()
    await as_user(client, uid)
    assert (await client.get("/api/account/2fa")).json() == {"available": False, "enabled": False}
    assert (await client.post("/api/account/2fa/start", json={"password": "password123"})).status_code == 503
