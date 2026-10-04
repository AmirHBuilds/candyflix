"""Footer: public read, admin-only edit, validation."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.site_setting import SiteSetting
from app.schemas.site import Footer
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
async def restore_footer():
    async with AsyncSessionLocal() as s:
        row = await s.get(SiteSetting, "footer")
        saved = dict(row.value) if row else None
    yield
    async with AsyncSessionLocal() as s:
        row = await s.get(SiteSetting, "footer")
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
    name = f"ftr_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin)
        uid = user.id
    token = await auth_service.create_session(uid)
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return name


async def _cleanup(name):
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, name)
        if u:
            await db.delete(u)
            await db.commit()


GOOD = {
    "enabled": True,
    "tagline": "Movie night",
    "email": "hi@example.com",
    "links": [{"label": "Help", "url": "https://example.com/help"}],
    "copyright": "Candy",
}


async def test_public_read_returns_defaults_without_login(client):
    res = await client.get("/api/site/footer")
    assert res.status_code == 200
    assert res.json()["enabled"] is True


async def test_admin_can_edit_and_everyone_sees_it(client):
    name = await _login(client, True)
    try:
        res = await client.put("/api/admin/footer", json=GOOD)
        assert res.status_code == 200
    finally:
        await _cleanup(name)
    client.cookies.clear()
    got = (await client.get("/api/site/footer")).json()
    assert got["email"] == "hi@example.com"
    assert got["links"][0]["label"] == "Help"


async def test_regular_user_and_anonymous_cannot_edit(client):
    assert (await client.put("/api/admin/footer", json=GOOD)).status_code == 401
    name = await _login(client, False)
    try:
        assert (await client.put("/api/admin/footer", json=GOOD)).status_code == 403
    finally:
        await _cleanup(name)


@pytest.mark.parametrize(
    "patch",
    [
        {"email": "not-an-email"},
        {"links": [{"label": "x", "url": "javascript:alert(1)"}]},
        {"links": [{"label": " ", "url": "https://a.b"}]},
        {"tagline": "x" * 161},
        {"links": [{"label": "l", "url": "https://a.b"}] * 9},
    ],
)
async def test_invalid_footer_is_rejected(client, patch):
    name = await _login(client, True)
    try:
        res = await client.put("/api/admin/footer", json={**GOOD, **patch})
        assert res.status_code == 422
    finally:
        await _cleanup(name)


async def test_corrupt_stored_value_falls_back_to_defaults():
    async with AsyncSessionLocal() as db:
        db.add(SiteSetting(key="footer", value={"links": "nope"})) if not await db.get(SiteSetting, "footer") else None
        row = await db.get(SiteSetting, "footer")
        row.value = {"links": "nope"}
        await db.commit()
        assert await site_service.get_footer(db) == Footer()
