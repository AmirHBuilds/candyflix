"""Home banners: public read, admin-only edit, validation, safe fallback."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.site_setting import SiteSetting
from app.schemas.site import HomeBanners
from app.services import auth_service, site_service

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
async def restore_banners():
    async with AsyncSessionLocal() as s:
        row = await s.get(SiteSetting, "home_banners")
        saved = dict(row.value) if row else None
    yield
    async with AsyncSessionLocal() as s:
        row = await s.get(SiteSetting, "home_banners")
        if saved is None:
            if row:
                await s.delete(row)
        elif row:
            row.value = saved
        await s.commit()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _login(client, is_admin):
    name = f"bnr_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin)
        uid = user.id
    client.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))
    return name


async def _cleanup(name):
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, name)
        if u:
            await db.delete(u)
            await db.commit()


def _three(**first):
    base = [{"enabled": True, "title": f"T{i}", "text": f"Words {i}"} for i in range(3)]
    base[0].update(first)
    return {"banners": base}


async def test_public_read_gives_three_default_banners_without_login(client):
    body = (await client.get("/api/site/banners")).json()
    assert len(body["banners"]) == 3
    assert all(b["enabled"] and b["title"] and b["text"] for b in body["banners"])


async def test_admin_can_edit_switch_off_and_everyone_sees_it(client):
    name = await _login(client, True)
    try:
        res = await client.put("/api/admin/banners", json=_three(enabled=False, title="  Hello  "))
        assert res.status_code == 200
    finally:
        await _cleanup(name)
    client.cookies.clear()
    first = (await client.get("/api/site/banners")).json()["banners"][0]
    assert first["enabled"] is False and first["title"] == "Hello"


async def test_regular_user_and_anonymous_cannot_edit(client):
    assert (await client.put("/api/admin/banners", json=_three())).status_code == 401
    name = await _login(client, False)
    try:
        assert (await client.put("/api/admin/banners", json=_three())).status_code == 403
    finally:
        await _cleanup(name)


@pytest.mark.parametrize(
    "payload",
    [
        {"banners": _three()["banners"][:2]},
        {"banners": _three()["banners"] * 2},
        _three(title="x" * 61),
        _three(text="x" * 221),
        _three(title=" "),
    ],
)
async def test_invalid_banners_are_rejected(client, payload):
    name = await _login(client, True)
    try:
        assert (await client.put("/api/admin/banners", json=payload)).status_code == 422
    finally:
        await _cleanup(name)


async def test_a_switched_off_banner_may_be_empty(client):
    name = await _login(client, True)
    try:
        assert (await client.put("/api/admin/banners", json=_three(enabled=False, title="", text=""))).status_code == 200
    finally:
        await _cleanup(name)


async def test_corrupt_stored_value_falls_back_to_defaults():
    async with AsyncSessionLocal() as db:
        if not await db.get(SiteSetting, "home_banners"):
            db.add(SiteSetting(key="home_banners", value={}))
            await db.commit()
        row = await db.get(SiteSetting, "home_banners")
        row.value = {"banners": "nope"}
        await db.commit()
        assert await site_service.get_banners(db) == HomeBanners()
