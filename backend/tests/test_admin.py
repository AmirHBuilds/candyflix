"""/api/admin: access control, user management, safety rules, stats, system."""
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.user import User
from app.services import admin_service, auth_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    yield
    await redis.aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
def only_count_test_admins(monkeypatch):
    """The 'last admin' rule normally counts every admin in the database. Count
    only this file's `adm_` admins, so tests never depend on (or mutate) real ones."""

    async def fake(db, excluding):
        return (
            await db.scalar(
                select(func.count()).where(
                    User.username.like("adm\\_%", escape="\\"),
                    User.is_admin.is_(True),
                    User.is_disabled.is_(False),
                    User.id != excluding,
                )
            )
        ) or 0

    monkeypatch.setattr(admin_service, "_other_active_admins", fake)


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _name(prefix="adm") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def _login(client, db, username, is_admin=True, password="password123"):
    user = await auth_service.create_user(db, username, username.title(), password, is_admin=is_admin)
    token = await auth_service.create_session(user.id)
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return user, token


async def _cleanup(db, *usernames):
    await db.rollback()
    for name in usernames:
        u = await auth_service.get_user_by_username(db, name)
        if u is not None:
            await db.delete(u)
    await db.commit()


class TestAccessControl:
    ROUTES = [
        ("get", "/api/admin/users", {}),
        ("post", "/api/admin/users", {"json": {"username": "zzz", "display_name": "Z", "password": "password123"}}),
        ("patch", f"/api/admin/users/{uuid.uuid4()}", {"json": {"display_name": "X"}}),
        ("post", f"/api/admin/users/{uuid.uuid4()}/password", {"json": {"new_password": "password123"}}),
        ("delete", f"/api/admin/users/{uuid.uuid4()}", {}),
        ("get", "/api/admin/stats", {}),
        ("get", "/api/admin/system", {}),
        ("post", "/api/admin/system/clear-tmdb-cache", {}),
        ("post", "/api/admin/system/clear-subtitle-cache", {}),
        ("get", "/api/admin/footer", {}),
        ("put", "/api/admin/footer", {"json": {"enabled": True}}),
        ("get", "/api/admin/now-watching", {}),
        ("get", f"/api/admin/users/{uuid.uuid4()}/detail", {}),
        ("get", f"/api/admin/users/{uuid.uuid4()}/history", {}),
        ("get", f"/api/admin/users/{uuid.uuid4()}/watchlist", {}),
    ]

    @pytest.mark.parametrize("method,path,kwargs", ROUTES)
    async def test_401_when_signed_out(self, client, method, path, kwargs):
        assert (await getattr(client, method)(path, **kwargs)).status_code == 401

    @pytest.mark.parametrize("method,path,kwargs", ROUTES)
    async def test_403_for_a_regular_user(self, client, db, method, path, kwargs):
        name = _name("usr")
        try:
            await _login(client, db, name, is_admin=False)
            assert (await getattr(client, method)(path, **kwargs)).status_code == 403
        finally:
            await _cleanup(db, name)


class TestCreateAndList:
    async def test_creates_a_user_who_can_then_log_in(self, client, db):
        admin, new = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            resp = await client.post(
                "/api/admin/users",
                json={"username": new.upper(), "display_name": "  New   Kid ", "password": "password123"},
            )
            assert resp.status_code == 201
            body = resp.json()
            assert body["username"] == new  # normalised to lowercase
            assert body["display_name"] == "New Kid"
            assert body["is_admin"] is False and body["is_disabled"] is False

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as fresh:
                login = await fresh.post("/api/auth/login", json={"username": new, "password": "password123"})
                assert login.status_code == 200
        finally:
            await _cleanup(db, admin, new)

    async def test_can_create_another_admin(self, client, db):
        admin, new = _name(), _name()
        try:
            await _login(client, db, admin)
            resp = await client.post(
                "/api/admin/users",
                json={"username": new, "display_name": "B", "password": "password123", "is_admin": True},
            )
            assert resp.json()["is_admin"] is True
        finally:
            await _cleanup(db, admin, new)

    async def test_duplicate_username_is_409(self, client, db):
        admin = _name()
        try:
            await _login(client, db, admin)
            resp = await client.post(
                "/api/admin/users", json={"username": admin, "display_name": "D", "password": "password123"}
            )
            assert resp.status_code == 409
            assert "already taken" in resp.json()["detail"]
        finally:
            await _cleanup(db, admin)

    @pytest.mark.parametrize(
        "payload",
        [
            {"username": "ab", "display_name": "X", "password": "password123"},
            {"username": "has space", "display_name": "X", "password": "password123"},
            {"username": "-leading", "display_name": "X", "password": "password123"},
            {"username": "okname", "display_name": "   ", "password": "password123"},
            {"username": "okname", "display_name": "X", "password": "short"},
        ],
    )
    async def test_invalid_input_is_422(self, client, db, payload):
        admin = _name()
        try:
            await _login(client, db, admin)
            assert (await client.post("/api/admin/users", json=payload)).status_code == 422
        finally:
            await _cleanup(db, admin)

    async def test_list_includes_roles_flags_and_counts_but_never_hashes(self, client, db):
        admin = _name()
        try:
            await _login(client, db, admin)
            resp = await client.get("/api/admin/users")
            assert resp.status_code == 200
            mine = next(u for u in resp.json() if u["username"] == admin)
            assert mine["is_admin"] is True
            assert mine["watchlist_count"] == 0 and mine["watched_count"] == 0
            assert "password_hash" not in mine
        finally:
            await _cleanup(db, admin)


class TestUpdate:
    async def test_admin_can_rename_and_change_the_display_name(self, client, db):
        admin, target, new_name = _name(), _name("usr"), _name("ren")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            resp = await client.patch(f"/api/admin/users/{t.id}", json={"username": new_name, "display_name": "Renamed"})
            assert resp.status_code == 200
            assert resp.json()["username"] == new_name and resp.json()["display_name"] == "Renamed"
        finally:
            await _cleanup(db, admin, target, new_name)

    async def test_renaming_onto_an_existing_username_is_409(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            resp = await client.patch(f"/api/admin/users/{t.id}", json={"username": admin})
            assert resp.status_code == 409
        finally:
            await _cleanup(db, admin, target)

    async def test_unknown_user_is_404(self, client, db):
        admin = _name()
        try:
            await _login(client, db, admin)
            assert (await client.patch(f"/api/admin/users/{uuid.uuid4()}", json={"display_name": "X"})).status_code == 404
        finally:
            await _cleanup(db, admin)

    async def test_promote_and_revoke_admin(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            up = await client.patch(f"/api/admin/users/{t.id}", json={"is_admin": True})
            assert up.json()["is_admin"] is True
            down = await client.patch(f"/api/admin/users/{t.id}", json={"is_admin": False})
            assert down.json()["is_admin"] is False
        finally:
            await _cleanup(db, admin, target)

    async def test_disabling_signs_the_person_out_everywhere(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            token = await auth_service.create_session(t.id)
            tid = t.id

            resp = await client.patch(f"/api/admin/users/{tid}", json={"is_disabled": True})
            assert resp.status_code == 200 and resp.json()["is_disabled"] is True
            assert await auth_service.get_session_user_id(token) is None

            again = await client.patch(f"/api/admin/users/{tid}", json={"is_disabled": False})
            assert again.json()["is_disabled"] is False
        finally:
            await _cleanup(db, admin, target)


class TestSafetyRules:
    async def test_you_cannot_disable_yourself(self, client, db):
        admin, other = _name(), _name()
        try:
            me, _ = await _login(client, db, admin)
            await auth_service.create_user(db, other, "O", "password123", is_admin=True)
            resp = await client.patch(f"/api/admin/users/{me.id}", json={"is_disabled": True})
            assert resp.status_code == 400 and "own account" in resp.json()["detail"]
        finally:
            await _cleanup(db, admin, other)

    async def test_the_last_active_admin_cannot_demote_themselves(self, client, db):
        admin = _name()
        try:
            me, _ = await _login(client, db, admin)
            resp = await client.patch(f"/api/admin/users/{me.id}", json={"is_admin": False})
            assert resp.status_code == 400 and "at least one active admin" in resp.json()["detail"]
        finally:
            await _cleanup(db, admin)

    async def test_demoting_yourself_is_fine_when_another_admin_exists(self, client, db):
        admin, other = _name(), _name()
        try:
            me, _ = await _login(client, db, admin)
            await auth_service.create_user(db, other, "O", "password123", is_admin=True)
            resp = await client.patch(f"/api/admin/users/{me.id}", json={"is_admin": False})
            assert resp.status_code == 200
        finally:
            await _cleanup(db, admin, other)

    async def test_you_cannot_delete_yourself(self, client, db):
        admin, other = _name(), _name()
        try:
            me, _ = await _login(client, db, admin)
            await auth_service.create_user(db, other, "O", "password123", is_admin=True)
            resp = await client.delete(f"/api/admin/users/{me.id}")
            assert resp.status_code == 400 and "own account" in resp.json()["detail"]
        finally:
            await _cleanup(db, admin, other)

    async def test_you_cannot_reset_your_own_password_here(self, client, db):
        admin = _name()
        try:
            me, _ = await _login(client, db, admin)
            resp = await client.post(f"/api/admin/users/{me.id}/password", json={"new_password": "password456"})
            assert resp.status_code == 400 and "Account settings" in resp.json()["detail"]
        finally:
            await _cleanup(db, admin)


class TestResetAndDelete:
    async def test_reset_password_changes_it_and_signs_the_person_out(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            token = await auth_service.create_session(t.id)

            resp = await client.post(f"/api/admin/users/{t.id}/password", json={"new_password": "brandnew123"})
            assert resp.status_code == 204
            assert await auth_service.get_session_user_id(token) is None

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as fresh:
                old = await fresh.post("/api/auth/login", json={"username": target, "password": "password123"})
                new = await fresh.post("/api/auth/login", json={"username": target, "password": "brandnew123"})
            assert old.status_code == 401 and new.status_code == 200
        finally:
            await _cleanup(db, admin, target)

    async def test_reset_with_a_short_password_is_422(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            resp = await client.post(f"/api/admin/users/{t.id}/password", json={"new_password": "short"})
            assert resp.status_code == 422
        finally:
            await _cleanup(db, admin, target)

    async def test_delete_removes_the_user_and_their_sessions(self, client, db):
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            tid, token = t.id, await auth_service.create_session(t.id)

            assert (await client.delete(f"/api/admin/users/{tid}")).status_code == 204

            assert await auth_service.get_session_user_id(token) is None
            await db.rollback()
            assert (await db.execute(select(User).where(User.id == tid))).scalar_one_or_none() is None
            assert (await client.delete(f"/api/admin/users/{tid}")).status_code == 404
        finally:
            await _cleanup(db, admin, target)

    async def test_deleting_removes_their_avatar_file(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setattr(get_settings(), "avatars_dir", str(tmp_path))
        admin, target = _name(), _name("usr")
        try:
            await _login(client, db, admin)
            t = await auth_service.create_user(db, target, "T", "password123")
            (tmp_path / "gone.webp").write_bytes(b"x")
            t.avatar_path = "gone.webp"
            await db.commit()
            tid = t.id

            await client.delete(f"/api/admin/users/{tid}")
            assert not (tmp_path / "gone.webp").exists()
        finally:
            await _cleanup(db, admin, target)


class TestStats:
    async def test_shape_and_a_14_day_activity_series(self, client, db):
        admin = _name()
        try:
            await _login(client, db, admin)
            resp = await client.get("/api/admin/stats")
            assert resp.status_code == 200
            body = resp.json()
            assert body["users_total"] >= 1 and body["admins"] >= 1
            assert len(body["activity"]) == 14
            dates = [d["date"] for d in body["activity"]]
            assert dates == sorted(dates)
            assert len(body["top_titles"]) <= 5
            assert all(k in body for k in ("disabled", "active_last_7_days", "watchlist_items", "watched_items", "recent_logins"))
        finally:
            await _cleanup(db, admin)

    async def test_a_login_shows_up_in_recent_logins(self, client, db):
        admin = _name()
        try:
            await auth_service.create_user(db, admin, "A", "password123", is_admin=True)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
                await other.post("/api/auth/login", json={"username": admin, "password": "password123"})
                body = (await other.get("/api/admin/stats")).json()
            assert admin in [r["username"] for r in body["recent_logins"]]
        finally:
            await _cleanup(db, admin)


class TestSystem:
    @respx.mock
    async def test_reports_every_service_and_storage(self, client, db, monkeypatch):
        settings = get_settings()
        monkeypatch.setattr(settings, "tmdb_api_key", "k")
        monkeypatch.setattr(settings, "opensubtitles_api_key", "")
        respx.get(f"{settings.tmdb_base_url}/configuration").mock(return_value=httpx.Response(200, json={}))
        admin = _name()
        try:
            await _login(client, db, admin)
            body = (await client.get("/api/admin/system")).json()
            assert body["database"]["ok"] and body["redis"]["ok"] and body["tmdb"]["ok"]
            assert body["opensubtitles"]["ok"] is False
            assert set(body["subtitle_cache"]) == {"files", "bytes"}
            assert body["app_version"] and body["python_version"]
            assert isinstance(body["auto_migrate"], bool)
        finally:
            await _cleanup(db, admin)

    @respx.mock
    @pytest.mark.parametrize(
        "status,fragment", [(401, "rejected the API key"), (500, "HTTP 500")]
    )
    async def test_tmdb_failures_are_explained(self, monkeypatch, status, fragment):
        settings = get_settings()
        monkeypatch.setattr(settings, "tmdb_api_key", "k")
        respx.get(f"{settings.tmdb_base_url}/configuration").mock(return_value=httpx.Response(status))
        check = await admin_service._check_tmdb()
        assert check.ok is False and fragment in check.detail

    @respx.mock
    async def test_tmdb_unreachable_is_reported_not_raised(self, monkeypatch):
        settings = get_settings()
        monkeypatch.setattr(settings, "tmdb_api_key", "k")
        respx.get(f"{settings.tmdb_base_url}/configuration").mock(side_effect=httpx.ConnectError("boom"))
        check = await admin_service._check_tmdb()
        assert check.ok is False and "Can't reach TMDB" in check.detail

    async def test_missing_tmdb_key_is_reported(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "tmdb_api_key", "")
        check = await admin_service._check_tmdb()
        assert check.ok is False and "TMDB_API_KEY" in check.detail

    async def test_clear_tmdb_cache_removes_only_tmdb_keys(self, client, db):
        admin = _name()
        redis = redis_module.get_redis()
        try:
            await _login(client, db, admin)
            await redis.set("tmdb:test:a", "1")
            await redis.set("tmdb:test:b", "1")
            await redis.set("other:test:keep", "1")
            resp = await client.post("/api/admin/system/clear-tmdb-cache")
            assert resp.status_code == 200 and resp.json()["cleared"] >= 2
            assert await redis.get("tmdb:test:a") is None
            assert await redis.get("other:test:keep") == "1"
        finally:
            await redis.delete("other:test:keep")
            await _cleanup(db, admin)

    async def test_clear_subtitle_cache_deletes_files_but_keeps_gitkeep(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setattr(get_settings(), "subtitle_cache_dir", str(tmp_path))
        (tmp_path / "a.vtt").write_text("x")
        (tmp_path / "b.vtt").write_text("y")
        (tmp_path / ".gitkeep").write_text("")
        admin = _name()
        try:
            await _login(client, db, admin)
            resp = await client.post("/api/admin/system/clear-subtitle-cache")
            assert resp.json()["cleared"] == 2
            assert [p.name for p in tmp_path.iterdir()] == [".gitkeep"]
        finally:
            await _cleanup(db, admin)
