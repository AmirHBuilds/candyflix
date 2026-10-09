"""/api/account: display name, password, avatar — and the session/disabled rules."""
import io
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service

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
def avatars_in_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "avatars_dir", str(tmp_path))
    return tmp_path


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _name() -> str:
    return f"acct_{uuid.uuid4().hex[:8]}"


async def _login(client, db, username, password="oldpassword1", **kw):
    user = await auth_service.create_user(db, username, username.title(), password, **kw)
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


def png(size=(300, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buf, "PNG")
    return buf.getvalue()


class TestAuthRequired:
    @pytest.mark.parametrize(
        "method,path,kwargs",
        [
            ("patch", "/api/account/profile", {"json": {"display_name": "X"}}),
            ("post", "/api/account/password", {"json": {"current_password": "a", "new_password": "b" * 8}}),
            ("put", "/api/account/avatar", {"files": {"file": ("a.png", b"x", "image/png")}}),
            ("delete", "/api/account/avatar", {}),
        ],
    )
    async def test_401_without_a_session(self, client, method, path, kwargs):
        assert (await getattr(client, method)(path, **kwargs)).status_code == 401


class TestDisplayName:
    async def test_changes_the_display_name_but_never_the_username(self, client, db):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.patch("/api/account/profile", json={"display_name": "  Sweet   Candy  "})
            assert resp.status_code == 200
            assert resp.json()["display_name"] == "Sweet Candy"
            assert resp.json()["username"] == name
            assert (await client.get("/api/auth/me")).json()["display_name"] == "Sweet Candy"
        finally:
            await _cleanup(db, name)

    @pytest.mark.parametrize("bad", ["", "   ", "x" * 51])
    async def test_rejects_empty_or_too_long_names(self, client, db, bad):
        name = _name()
        try:
            await _login(client, db, name)
            assert (await client.patch("/api/account/profile", json={"display_name": bad})).status_code == 422
        finally:
            await _cleanup(db, name)

    async def test_a_username_field_in_the_body_is_ignored(self, client, db):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.patch("/api/account/profile", json={"display_name": "Ok", "username": "hacker"})
            assert resp.json()["username"] == name
        finally:
            await _cleanup(db, name)


class TestPassword:
    async def test_changing_it_works_for_the_next_login(self, client, db):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.post(
                "/api/account/password", json={"current_password": "oldpassword1", "new_password": "newpassword2"}
            )
            assert resp.status_code == 204
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as fresh:
                assert (await fresh.post("/api/auth/login", json={"username": name, "password": "oldpassword1"})).status_code == 401
                assert (await fresh.post("/api/auth/login", json={"username": name, "password": "newpassword2"})).status_code == 200
        finally:
            await _cleanup(db, name)

    async def test_the_wrong_current_password_is_refused(self, client, db):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.post(
                "/api/account/password", json={"current_password": "nope-nope", "new_password": "newpassword2"}
            )
            assert resp.status_code == 400
            assert "current password is incorrect" in resp.json()["detail"]
        finally:
            await _cleanup(db, name)

    async def test_the_new_password_must_differ_and_be_long_enough(self, client, db):
        name = _name()
        try:
            await _login(client, db, name)
            same = await client.post(
                "/api/account/password", json={"current_password": "oldpassword1", "new_password": "oldpassword1"}
            )
            short = await client.post(
                "/api/account/password", json={"current_password": "oldpassword1", "new_password": "short"}
            )
            assert same.status_code == 400
            assert short.status_code == 422
        finally:
            await _cleanup(db, name)

    async def test_other_devices_are_signed_out_but_this_one_stays_in(self, client, db):
        name = _name()
        try:
            user, this_token = await _login(client, db, name)
            other_token = await auth_service.create_session(user.id)  # e.g. a phone

            resp = await client.post(
                "/api/account/password", json={"current_password": "oldpassword1", "new_password": "newpassword2"}
            )
            assert resp.status_code == 204

            assert await auth_service.get_session_user_id(this_token) == user.id
            assert await auth_service.get_session_user_id(other_token) is None
        finally:
            await _cleanup(db, name)


class TestAvatar:
    async def test_upload_returns_a_url_and_stores_a_256_webp(self, client, db, avatars_in_tmp):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.put("/api/account/avatar", files={"file": ("me.png", png(), "image/png")})

            assert resp.status_code == 200
            url = resp.json()["avatar_url"]
            assert url.startswith("/avatars/") and url.endswith(".webp")
            saved = avatars_in_tmp / url.removeprefix("/avatars/")
            assert Image.open(saved).size == (256, 256)
            assert (await client.get("/api/auth/me")).json()["avatar_url"] == url
        finally:
            await _cleanup(db, name)

    async def test_a_new_upload_replaces_the_old_file(self, client, db, avatars_in_tmp):
        name = _name()
        try:
            await _login(client, db, name)
            first = (await client.put("/api/account/avatar", files={"file": ("a.png", png(), "image/png")})).json()["avatar_url"]
            second = (await client.put("/api/account/avatar", files={"file": ("b.png", png((50, 80)), "image/png")})).json()["avatar_url"]

            assert first != second  # new URL, so no stale picture in the browser cache
            assert sorted(p.name for p in avatars_in_tmp.iterdir()) == [second.removeprefix("/avatars/")]
        finally:
            await _cleanup(db, name)

    async def test_removing_it_deletes_the_file_and_clears_the_url(self, client, db, avatars_in_tmp):
        name = _name()
        try:
            await _login(client, db, name)
            await client.put("/api/account/avatar", files={"file": ("a.png", png(), "image/png")})
            resp = await client.delete("/api/account/avatar")

            assert resp.status_code == 200
            assert resp.json()["avatar_url"] is None
            assert list(avatars_in_tmp.iterdir()) == []
        finally:
            await _cleanup(db, name)

    @pytest.mark.parametrize("content,status", [(b"not an image at all", 415), (b"", 400)])
    async def test_bad_files_are_refused_with_a_message_and_nothing_is_stored(
        self, client, db, avatars_in_tmp, content, status
    ):
        name = _name()
        try:
            await _login(client, db, name)
            resp = await client.put("/api/account/avatar", files={"file": ("x.png", content, "image/png")})
            assert resp.status_code == status
            assert resp.json()["detail"]
            assert list(avatars_in_tmp.iterdir()) == []
            assert (await client.get("/api/auth/me")).json()["avatar_url"] is None
        finally:
            await _cleanup(db, name)

    async def test_files_over_the_limit_are_refused(self, client, db, monkeypatch):
        monkeypatch.setattr(get_settings(), "max_avatar_bytes", 2000)
        name = _name()
        try:
            await _login(client, db, name)
            big = io.BytesIO()
            Image.effect_noise((200, 200), 100).save(big, "PNG")
            assert len(big.getvalue()) > 2000
            resp = await client.put("/api/account/avatar", files={"file": ("big.png", big.getvalue(), "image/png")})
            assert resp.status_code == 413
        finally:
            await _cleanup(db, name)

    async def test_the_login_picker_shows_avatars_and_the_admin_flag_only(self, client, db):
        name = _name()
        try:
            await _login(client, db, name, is_admin=True)
            await client.put("/api/account/avatar", files={"file": ("a.png", png(), "image/png")})
            mine = next(p for p in (await client.get("/api/auth/users")).json() if p["username"] == name)
            assert mine["avatar_url"].startswith("/avatars/")
            assert mine["is_admin"] is True  # for the crown
            assert "is_disabled" not in mine and "password_hash" not in mine
        finally:
            await _cleanup(db, name)


class TestDisabledAccounts:
    async def test_a_disabled_account_is_refused_at_login_only_after_the_right_password(self, client, db):
        name = _name()
        try:
            user = await auth_service.create_user(db, name, "X", "oldpassword1")
            user.is_disabled = True
            await db.commit()

            right = await client.post("/api/auth/login", json={"username": name, "password": "oldpassword1"})
            wrong = await client.post("/api/auth/login", json={"username": name, "password": "wrongwrong1"})

            assert right.status_code == 403 and "disabled" in right.json()["detail"]
            assert wrong.status_code == 401  # a guesser learns nothing about the account
        finally:
            await _cleanup(db, name)

    async def test_disabling_cuts_off_an_existing_session_immediately(self, client, db):
        name = _name()
        try:
            user, _ = await _login(client, db, name)
            assert (await client.get("/api/auth/me")).status_code == 200
            user.is_disabled = True
            await db.commit()
            resp = await client.get("/api/auth/me")
            assert resp.status_code == 401 and resp.json()["detail"] == "Account disabled"
        finally:
            await _cleanup(db, name)


class TestSessionIndex:
    async def test_logout_removes_the_session_from_the_per_user_index(self, client, db):
        name = _name()
        try:
            user, token = await _login(client, db, name)
            redis = redis_module.get_redis()
            assert token in await redis.smembers(f"user_sessions:{user.id}")
            await client.post("/api/auth/logout")
            assert token not in await redis.smembers(f"user_sessions:{user.id}")
            assert await auth_service.get_session_user_id(token) is None
        finally:
            await _cleanup(db, name)

    async def test_invalidate_user_sessions_ends_all_and_reports_the_count(self, client, db):
        name = _name()
        try:
            user, _ = await _login(client, db, name)
            await auth_service.create_session(user.id)
            await auth_service.create_session(user.id)
            assert await auth_service.invalidate_user_sessions(user.id) == 3
            assert await auth_service.invalidate_user_sessions(user.id) == 0
        finally:
            await _cleanup(db, name)
