"""The admin crown on the login screen: public read, admin-only edit, safe uploads."""
import io
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.site_setting import SiteSetting
from app.services import auth_service

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
async def restore_badge():
    yield
    async with AsyncSessionLocal() as s:
        row = await s.get(SiteSetting, "admin_badge")
        if row:
            image = (row.value or {}).get("image")
            await s.delete(row)
            await s.commit()
            if image:
                (Path(get_settings().avatars_dir) / image).unlink(missing_ok=True)


async def _client(is_admin: bool):
    name = f"bd_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, name, "Badge Tester", "testpass123", is_admin=is_admin)
        token = await auth_service.create_session(user.id)
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    c.cookies.set(SESSION_COOKIE_NAME, token)
    return c, name


async def _drop(c, name):
    await c.aclose()
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, name)
        if u:
            await db.delete(u)
            await db.commit()


@pytest.fixture
async def admin():
    c, n = await _client(True)
    yield c
    await _drop(c, n)


@pytest.fixture
async def person():
    c, n = await _client(False)
    yield c
    await _drop(c, n)


def _png(size=(900, 600), mode="RGBA", fmt="PNG"):
    buf = io.BytesIO()
    Image.new(mode, size, (255, 200, 0, 128) if mode == "RGBA" else (255, 200, 0)).save(buf, format=fmt)
    return buf.getvalue()


async def test_default_is_the_built_in_crown_top_left_and_anyone_can_read_it(person):
    body = (await person.get("/api/site/badge")).json()
    assert body == {"position": "top-left", "image_url": None}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get("/api/site/badge")).status_code == 200  # the login screen is signed out


async def test_admin_chooses_where_it_sits_and_nobody_else_can(admin, person):
    for pos in ("top", "top-right", "top-left"):
        r = await admin.put("/api/admin/badge", json={"position": pos})
        assert r.status_code == 200 and r.json()["position"] == pos
        assert (await person.get("/api/site/badge")).json()["position"] == pos
    assert (await admin.put("/api/admin/badge", json={"position": "bottom"})).status_code == 422
    assert (await person.put("/api/admin/badge", json={"position": "top"})).status_code == 403
    assert (await person.put("/api/admin/badge/image", files={"file": ("b.png", _png(), "image/png")})).status_code == 403


async def test_upload_keeps_transparency_shrinks_it_serves_it_and_reset_removes_the_file(admin, person):
    r = await admin.put("/api/admin/badge/image", files={"file": ("crown.png", _png(), "image/png")})
    assert r.status_code == 200
    url = r.json()["image_url"]
    assert url.startswith("/avatars/badge-") and url.endswith(".png")
    path = Path(get_settings().avatars_dir) / url.rsplit("/", 1)[1]
    with Image.open(path) as im:
        assert im.format == "PNG" and im.mode == "RGBA" and max(im.size) == 512
    assert (await person.get("/api/site/badge")).json()["image_url"] == url

    r2 = await admin.put("/api/admin/badge/image", files={"file": ("crown2.png", _png((100, 100)), "image/png")})
    assert r2.json()["image_url"] != url and not path.exists()  # the old file is cleaned up

    new_path = Path(get_settings().avatars_dir) / r2.json()["image_url"].rsplit("/", 1)[1]
    r3 = await admin.delete("/api/admin/badge/image")
    assert r3.json()["image_url"] is None and not new_path.exists()


async def test_bad_uploads_are_refused(admin):
    put = lambda data, name="x.png": admin.put("/api/admin/badge/image", files={"file": (name, data, "image/png")})
    assert (await put(b"")).status_code == 400
    assert (await put(b"not an image at all")).status_code == 415
    assert (await put(_png(mode="RGB", fmt="JPEG"), "x.jpg")).status_code == 415  # PNG / WebP only
    assert (await put(b"\x89PNG" + b"0" * 2_100_000)).status_code == 413


async def test_the_picker_list_names_admins_and_the_upload_is_audited(admin):
    me = next(p for p in (await admin.get("/api/auth/users")).json() if p["display_name"] == "Badge Tester")
    assert me["is_admin"] is True
    await admin.put("/api/admin/badge", json={"position": "top"})
    log = (await admin.get("/api/admin/audit")).json()
    assert any(e["action"] == "badge.update" for e in log["items"])
