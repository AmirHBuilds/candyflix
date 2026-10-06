"""
Settings: schema defaults/validation, the sparse-merge service, and the
/api/settings routes (real app + Postgres/Redis, like the other route tests).
"""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import text

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.user_settings import UserSettings as UserSettingsRow
from app.schemas.settings import UserSettings
from app.services import auth_service, settings_service
from app.services.settings_service import deep_merge, resolve, resolve_leniently, unknown_paths

pytestmark = pytest.mark.asyncio


# ---------- pure unit tests ----------


class TestDefaults:
    def test_defaults_match_todays_behaviour(self):
        """Nothing changes for anyone until they change a setting."""
        s = UserSettings()
        assert s.appearance.theme == "candy-at-night"
        assert s.appearance.home_layout == "grid"
        assert s.appearance.items_per_section == 24
        assert s.appearance.episode_view == "list"
        assert s.appearance.description_length == "standard"
        assert s.appearance.hero_interval_seconds == 7
        assert s.playback.autoplay_on_open is True
        assert s.playback.seek_seconds == 10
        assert s.playback.save_progress is True
        assert s.playback.auto_skip_intro is False
        assert s.subtitles.font_size == 22
        assert s.subtitles.color == "#ffffff"
        assert s.subtitles.position == "bottom"

    def test_subtitle_style_has_no_timing_offset(self):
        # Timing is per-video only: every release is synced differently.
        assert "offset_seconds" not in UserSettings().subtitles.model_dump()


class TestValidation:
    @pytest.mark.parametrize(
        "overrides",
        [
            {"appearance": {"theme": "neon"}},
            {"appearance": {"items_per_section": 5}},
            {"appearance": {"items_per_section": 49}},
            {"appearance": {"hero_interval_seconds": 2}},
            {"playback": {"seek_seconds": 7}},
            {"subtitles": {"color": "red"}},
            {"subtitles": {"background_opacity": 1.5}},
            {"subtitles": {"font_size": 9}},
            {"playback": {"auto_subtitles": {"language": "x"}}},
        ],
    )
    def test_rejects_out_of_range_values(self, overrides):
        with pytest.raises(ValidationError):
            resolve(overrides)

    @pytest.mark.parametrize("seconds", [5, 10, 15, 20, 30])
    def test_every_documented_seek_time_is_valid(self, seconds):
        assert resolve({"playback": {"seek_seconds": seconds}}).playback.seek_seconds == seconds

    def test_nested_groups_merge_over_defaults(self):
        s = resolve({"playback": {"skip_buttons": {"recap": False}}})
        assert s.playback.skip_buttons.recap is False
        assert s.playback.skip_buttons.intro is True  # untouched sibling keeps its default


class TestMergeAndUnknownKeys:
    def test_deep_merge_keeps_siblings(self):
        merged = deep_merge({"appearance": {"theme": "mint", "text_size": "large"}}, {"appearance": {"theme": "lilac"}})
        assert merged == {"appearance": {"theme": "lilac", "text_size": "large"}}

    def test_null_removes_an_override_and_prunes_empty_groups(self):
        merged = deep_merge({"appearance": {"theme": "mint"}}, {"appearance": {"theme": None}})
        assert merged == {}

    def test_inputs_are_not_mutated(self):
        base = {"appearance": {"theme": "mint"}}
        deep_merge(base, {"appearance": {"theme": "lilac"}})
        assert base == {"appearance": {"theme": "mint"}}

    def test_unknown_paths_are_reported_with_their_full_path(self):
        problems = unknown_paths({"appearance": {"colour": "x"}, "nonsense": {"a": 1}}, UserSettings)
        assert "Unknown setting 'appearance.colour'" in problems
        assert "Unknown setting 'nonsense'" in problems

    def test_a_group_must_be_an_object(self):
        assert unknown_paths({"appearance": "mint"}, UserSettings) == ["'appearance' must be an object"]

    def test_deeply_nested_known_paths_are_fine(self):
        assert unknown_paths({"playback": {"skip_buttons": {"intro": False}}}, UserSettings) == []


class TestLenientRead:
    def test_drops_only_the_bad_override_and_keeps_the_rest(self):
        s = resolve_leniently({"appearance": {"theme": "mint", "items_per_section": 999}})
        assert s.appearance.theme == "mint"
        assert s.appearance.items_per_section == 24  # fell back to the default

    def test_survives_garbage(self):
        assert resolve_leniently({"playback": {"seek_seconds": "soon"}, "appearance": 5}).playback.seek_seconds == 10

    def test_unknown_stored_keys_are_ignored_not_fatal(self):
        assert resolve_leniently({"removed_feature": {"x": 1}}).appearance.theme == "candy-at-night"


# ---------- route / DB tests ----------


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


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _login_as(client: AsyncClient, db, username: str, is_admin: bool = False):
    user = await auth_service.create_user(db, username, username.title(), "testpass123", is_admin=is_admin)
    token = await auth_service.create_session(user.id)
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return user


async def _cleanup(db, *usernames: str):
    for name in usernames:
        user = await auth_service.get_user_by_username(db, name)
        if user is not None:
            await db.delete(user)
    await db.commit()


def _name() -> str:
    return f"set_{uuid.uuid4().hex[:8]}"


class TestRoutesRequireAuth:
    @pytest.mark.parametrize("method", ["get", "patch", "delete"])
    async def test_401_without_a_session(self, client, method):
        kwargs = {"json": {"appearance": {"theme": "mint"}}} if method == "patch" else {}
        assert (await getattr(client, method)("/api/settings", **kwargs)).status_code == 401


class TestSettingsRoutes:
    async def test_new_user_gets_the_full_defaults_without_a_stored_row(self, client, db):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            body = (await client.get("/api/settings")).json()

            assert body == UserSettings().model_dump()
            assert await db.get(UserSettingsRow, uid) is None  # nothing stored yet
        finally:
            await _cleanup(db, name)

    async def test_patch_persists_and_only_the_changes_are_stored(self, client, db):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            resp = await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})

            assert resp.status_code == 200
            assert resp.json()["appearance"]["theme"] == "mint"
            assert resp.json()["appearance"]["text_size"] == "default"  # defaults still filled in

            again = (await client.get("/api/settings")).json()
            assert again["appearance"]["theme"] == "mint"

            await db.rollback()  # fresh read of what's actually stored
            row = await db.get(UserSettingsRow, uid)
            assert row.data == {"appearance": {"theme": "mint"}}  # sparse: just the change
        finally:
            await _cleanup(db, name)

    async def test_successive_patches_accumulate(self, client, db):
        name = _name()
        try:
            await _login_as(client, db, name)
            await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})
            await client.patch("/api/settings", json={"playback": {"seek_seconds": 20}})
            body = (await client.get("/api/settings")).json()
            assert body["appearance"]["theme"] == "mint"
            assert body["playback"]["seek_seconds"] == 20
        finally:
            await _cleanup(db, name)

    async def test_null_resets_one_setting_to_its_default(self, client, db):
        name = _name()
        try:
            await _login_as(client, db, name)
            await client.patch("/api/settings", json={"appearance": {"theme": "mint", "text_size": "large"}})
            resp = await client.patch("/api/settings", json={"appearance": {"theme": None}})
            body = resp.json()
            assert body["appearance"]["theme"] == "candy-at-night"
            assert body["appearance"]["text_size"] == "large"  # others untouched
        finally:
            await _cleanup(db, name)

    async def test_stored_values_are_the_validated_ones(self, client, db):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            await client.patch("/api/settings", json={"appearance": {"items_per_section": "12"}})
            await db.rollback()
            row = await db.get(UserSettingsRow, uid)
            assert row.data == {"appearance": {"items_per_section": 12}}  # int, not "12"
        finally:
            await _cleanup(db, name)

    @pytest.mark.parametrize(
        "bad",
        [
            {"appearance": {"theme": "neon"}},
            {"playback": {"seek_seconds": 7}},
            {"appearance": {"does_not_exist": True}},
            {"nonsense": {"a": 1}},
            {"appearance": "mint"},
        ],
    )
    async def test_invalid_patches_are_rejected_and_nothing_is_saved(self, client, db, bad):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            resp = await client.patch("/api/settings", json=bad)

            assert resp.status_code == 422
            assert isinstance(resp.json()["detail"], list) and resp.json()["detail"]
            await db.rollback()
            assert await db.get(UserSettingsRow, uid) is None
        finally:
            await _cleanup(db, name)

    async def test_a_bad_patch_does_not_clobber_earlier_good_settings(self, client, db):
        name = _name()
        try:
            await _login_as(client, db, name)
            await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})
            bad = await client.patch("/api/settings", json={"appearance": {"theme": "lilac", "text_size": "huge"}})
            assert bad.status_code == 422
            assert (await client.get("/api/settings")).json()["appearance"]["theme"] == "mint"
        finally:
            await _cleanup(db, name)

    async def test_non_object_body_is_rejected(self, client, db):
        name = _name()
        try:
            await _login_as(client, db, name)
            assert (await client.patch("/api/settings", json=["theme"])).status_code == 422
        finally:
            await _cleanup(db, name)

    async def test_delete_resets_everything(self, client, db):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})
            resp = await client.delete("/api/settings")

            assert resp.status_code == 200
            assert resp.json() == UserSettings().model_dump()
            await db.rollback()
            assert await db.get(UserSettingsRow, uid) is None
            assert (await client.get("/api/settings")).json()["appearance"]["theme"] == "candy-at-night"
        finally:
            await _cleanup(db, name)

    async def test_settings_are_private_to_each_user(self, client, db):
        a, b = _name(), _name()
        try:
            await _login_as(client, db, a)
            await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})

            await _login_as(client, db, b)  # the client now carries b's session
            assert (await client.get("/api/settings")).json()["appearance"]["theme"] == "candy-at-night"
        finally:
            await _cleanup(db, a, b)

    async def test_deleting_a_user_deletes_their_settings(self, client, db):
        name = _name()
        user = await _login_as(client, db, name)
        user_id = user.id
        await client.patch("/api/settings", json={"appearance": {"theme": "mint"}})
        await _cleanup(db, name)
        await db.rollback()
        assert await db.get(UserSettingsRow, user_id) is None  # ON DELETE CASCADE

    async def test_a_corrupt_stored_value_does_not_break_the_page(self, client, db):
        name = _name()
        try:
            user = await _login_as(client, db, name)
            uid = user.id
            db.add(UserSettingsRow(user_id=user.id, data={"appearance": {"theme": "mint", "items_per_section": 9999}}))
            await db.commit()

            resp = await client.get("/api/settings")
            assert resp.status_code == 200
            assert resp.json()["appearance"]["theme"] == "mint"
            assert resp.json()["appearance"]["items_per_section"] == 24
        finally:
            await _cleanup(db, name)


class TestRolesAndAuthShape:
    async def test_me_reports_admin_flag(self, client, db):
        a, n = _name(), _name()
        try:
            await _login_as(client, db, a, is_admin=True)
            assert (await client.get("/api/auth/me")).json()["is_admin"] is True
            await _login_as(client, db, n)
            assert (await client.get("/api/auth/me")).json()["is_admin"] is False
        finally:
            await _cleanup(db, a, n)

    async def test_the_public_profile_list_does_not_reveal_who_is_admin(self, client, db):
        a = _name()
        try:
            await _login_as(client, db, a, is_admin=True)
            profiles = (await client.get("/api/auth/users")).json()
            mine = next(p for p in profiles if p["username"] == a)
            assert "is_admin" not in mine
            assert "password_hash" not in mine
        finally:
            await _cleanup(db, a)

    async def test_login_stamps_last_login_and_returns_the_flag(self, client, db):
        name = _name()
        try:
            user = await auth_service.create_user(db, name, "X", "testpass123", is_admin=True)
            assert user.last_login_at is None

            resp = await client.post("/api/auth/login", json={"username": name, "password": "testpass123"})

            assert resp.status_code == 200
            assert resp.json()["is_admin"] is True
            await db.refresh(user)
            assert user.last_login_at is not None
        finally:
            await _cleanup(db, name)

    async def test_failed_login_does_not_stamp_last_login(self, client, db):
        name = _name()
        try:
            user = await auth_service.create_user(db, name, "X", "testpass123")
            await client.post("/api/auth/login", json={"username": name, "password": "wrong"})
            await db.refresh(user)
            assert user.last_login_at is None
        finally:
            await _cleanup(db, name)


# The SQL the migration runs so an existing install gets a first admin.
# (Tested against a scratch TEMP table, never the real users.)
BOOTSTRAP_SQL = """
    UPDATE users SET is_admin = true
    WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
"""


async def test_bootstrap_sql_semantics_on_an_isolated_table(db):
    """Same statement, run against a scratch table so no real data is touched."""
    await db.execute(text("CREATE TEMP TABLE u (id int, created_at timestamptz, is_admin bool)"))
    await db.execute(text("INSERT INTO u VALUES (1, now() - interval '2 days', false), (2, now() - interval '1 day', false)"))
    sql = BOOTSTRAP_SQL.replace("users", "u")

    await db.execute(text(sql))
    rows = dict((await db.execute(text("SELECT id, is_admin FROM u"))).all())
    assert rows == {1: True, 2: False}  # oldest promoted

    await db.execute(text("UPDATE u SET is_admin = false WHERE id = 1"))
    await db.execute(text("UPDATE u SET is_admin = true WHERE id = 2"))
    await db.execute(text(sql))
    rows = dict((await db.execute(text("SELECT id, is_admin FROM u"))).all())
    assert rows == {1: False, 2: True}  # an admin already exists -> untouched
    await db.rollback()


def test_frontend_defaults_file_matches_the_backend_defaults():
    """frontend/lib/settings-defaults.json is the frontend's copy of the
    defaults (used while offline / before the server answers). It is
    generated from this schema, and this test fails the moment the two
    drift — regenerate it with the one-liner in PHASE_HANDOFF.md §17."""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "frontend" / "lib" / "settings-defaults.json"
    if not path.exists():  # e.g. running inside a backend-only container
        pytest.skip("frontend sources not present")
    assert json.loads(path.read_text()) == UserSettings().model_dump()


def test_player_controls_defaults_and_validation():
    from pydantic import ValidationError

    from app.services import settings_service

    c = UserSettings().playback.controls
    assert (c.episodes, c.volume, c.time, c.captions, c.fullscreen) == (True, True, True, True, True)
    assert (c.seek_back, c.seek_forward, c.pip) == (False, False, False)  # extras start off
    assert settings_service.resolve({"playback": {"controls": {"pip": True}}}).playback.controls.pip is True
    # Play/Pause and Settings can't be removed: there is no such key to set.
    assert settings_service.unknown_paths({"playback": {"controls": {"play": False}}}, UserSettings) == ["Unknown setting 'playback.controls.play'"]
    with pytest.raises(ValidationError):
        settings_service.resolve({"playback": {"controls": {"volume": "maybe"}}})
