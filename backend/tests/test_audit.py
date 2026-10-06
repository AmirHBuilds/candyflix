"""Phase 10d: audit trail of admin actions + sign-in log."""
import uuid

import pytest
from sqlalchemy import delete, inspect, select

from app.models.announcement import Announcement
from app.models.audit import AuditLog, SignInLog
from app.services import audit_service
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


def _id(user):
    return inspect(user).identity[0]  # works even when the object is expired


async def _mine(db, actor, action=None):
    q = select(AuditLog).where(AuditLog.actor_id == _id(actor)).order_by(AuditLog.at)
    if action:
        q = q.where(AuditLog.action == action)
    return (await db.execute(q)).scalars().all()


async def _wipe(db, *actors):
    await db.rollback()
    for a in actors:
        await db.execute(delete(AuditLog).where(AuditLog.actor_id == _id(a)))
    await db.commit()


def test_device_labels():
    d = audit_service.device_label
    assert d(None) == "Unknown device"
    assert d("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36") == "Chrome on Windows"
    assert d("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0") == "Edge on Windows"
    assert d("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1") == "Safari on iOS"
    assert d("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0") == "Firefox on Linux"
    assert d("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36") == "Chrome on Android"
    assert d("curl/8.0") == "Unknown device"


async def test_routes_need_admin(client, db):
    for r in ("/api/admin/audit", "/api/admin/sign-in-log"):
        client.cookies.clear()
        assert (await client.get(r)).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        for r in ("/api/admin/audit", "/api/admin/sign-in-log"):
            assert (await client.get(r)).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_account_changes_are_recorded(client, db):
    admin, a, at = await _make(db, is_admin=True)
    other, o, _ = await _make(db)
    created = None
    try:
        as_(client, at)
        r = await client.post("/api/admin/users", json={"username": f"new_{uuid.uuid4().hex[:6]}", "display_name": "Newbie", "password": "password123", "is_admin": False})
        assert r.status_code == 201
        created = r.json()
        assert (await client.patch(f"/api/admin/users/{other.id}", json={"is_disabled": True})).status_code == 200
        assert (await client.patch(f"/api/admin/users/{other.id}", json={"is_disabled": False, "display_name": "Renamed", "is_admin": True})).status_code == 200
        assert (await client.post(f"/api/admin/users/{other.id}/password", json={"new_password": "password456"})).status_code == 204
        assert (await client.delete(f"/api/admin/users/{created['id']}")).status_code == 204
        created = None
        actions = [e.action for e in await _mine(db, admin)]
        assert actions == ["user.create", "user.disable", "user.update", "user.enable", "user.make_admin", "user.password_reset", "user.delete"]
        update = (await _mine(db, admin, "user.update"))[0]
        assert update.detail == "Changed display name" and update.target_name == "Renamed"
        gone = (await _mine(db, admin, "user.delete"))[0]
        assert gone.target_name == "Newbie"  # the record still reads after the person is gone
        # failed actions leave no trace
        before = len(await _mine(db, admin))
        assert (await client.delete(f"/api/admin/users/{admin.id}")).status_code in (400, 403, 409)
        assert len(await _mine(db, admin)) == before
    finally:
        await _wipe(db, admin)
        await _cleanup(db, a, o)


async def test_looking_at_history_is_recorded_once_per_window(client, db):
    admin, a, at = await _make(db, is_admin=True)
    viewer, v, _ = await _make(db)
    try:
        as_(client, at)
        for _ in range(3):
            assert (await client.get(f"/api/admin/users/{viewer.id}/history")).status_code == 200
        assert (await client.get(f"/api/admin/users/{viewer.id}/history?offset=50")).status_code == 200  # "load more" isn't a new look
        assert (await client.get(f"/api/admin/users/{viewer.id}/watchlist")).status_code == 200
        assert (await client.get(f"/api/admin/users/{viewer.id}/watchlist")).status_code == 200
        assert (await client.get(f"/api/admin/users/{viewer.id}/detail")).status_code == 200  # polled screen: not logged
        assert (await client.get("/api/admin/now-watching")).status_code == 200
        entries = await _mine(db, admin)
        assert [e.action for e in entries] == ["history.view", "watchlist.view"]
        assert entries[0].target_user_id == viewer.id and entries[0].target_name == viewer.display_name
        assert (await client.get(f"/api/admin/users/{uuid.uuid4()}/history")).status_code == 404
        assert len(await _mine(db, admin)) == 2
    finally:
        await _wipe(db, admin)
        await _cleanup(db, a, v)


async def test_messages_footer_and_caches_are_recorded(client, db):
    admin, a, at = await _make(db, is_admin=True)
    ann_id = None
    try:
        as_(client, at)
        r = await client.post("/api/admin/announcements", json={"title": "Hello all", "body": "Hi", "audience": "all"})
        ann_id = r.json()["id"]
        await client.patch(f"/api/admin/announcements/{ann_id}", json={"is_active": False})
        await client.patch(f"/api/admin/announcements/{ann_id}", json={"is_active": True})
        await client.patch(f"/api/admin/announcements/{ann_id}", json={"title": "Hello everyone"})
        await client.post(f"/api/admin/announcements/{ann_id}/reshow")
        await client.delete(f"/api/admin/announcements/{ann_id}")
        ann_id = None
        footer = (await client.get("/api/admin/footer")).json()
        assert (await client.put("/api/admin/footer", json=footer)).status_code == 200
        await client.post("/api/admin/system/clear-subtitle-cache")
        actions = [e.action for e in await _mine(db, admin)]
        assert actions == [
            "announcement.create", "announcement.stop", "announcement.resume", "announcement.update",
            "announcement.reshow", "announcement.delete", "footer.update", "cache.subtitle_clear",
        ]
        assert (await _mine(db, admin, "announcement.create"))[0].detail == "For everyone"
        assert (await _mine(db, admin, "announcement.delete"))[0].target_name == "Hello everyone"
    finally:
        if ann_id:
            row = await db.get(Announcement, uuid.UUID(ann_id))
            if row:
                await db.delete(row)
                await db.commit()
        await _wipe(db, admin)
        await _cleanup(db, a)


async def test_audit_list_is_paged_newest_first(client, db):
    admin, a, at = await _make(db, is_admin=True)
    try:
        for i in range(3):
            await audit_service.record(db, admin, "footer.update", detail=f"n{i}")
        as_(client, at)
        page = (await client.get("/api/admin/audit?limit=2")).json()
        assert len(page["items"]) == 2 and page["total"] >= 3
        assert [i["at"] for i in page["items"]] == sorted((i["at"] for i in page["items"]), reverse=True)
        assert page["items"][0]["actor_name"] == admin.display_name
        assert (await client.get("/api/admin/audit?limit=500")).status_code == 422
    finally:
        await _wipe(db, admin)
        await _cleanup(db, a)


async def test_sign_ins_are_logged_with_a_device_and_survive_listing(client, db):
    admin, a, at = await _make(db, is_admin=True)
    user, u, _ = await _make(db)
    uid = _id(user)
    try:
        client.cookies.clear()
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
        r = await client.post("/api/auth/login", json={"username": u, "password": "password123"}, headers={"User-Agent": ua})
        assert r.status_code == 200
        bad = await client.post("/api/auth/login", json={"username": u, "password": "wrong-password"})
        assert bad.status_code == 401  # failed attempts are not part of this log
        as_(client, at)
        page = (await client.get(f"/api/admin/sign-in-log?user_id={user.id}")).json()
        assert page["total"] == 1
        assert page["items"][0]["device"] == "Chrome on Windows" and page["items"][0]["username"] == u
        everyone = (await client.get("/api/admin/sign-in-log?limit=200")).json()
        assert everyone["total"] >= 1
    finally:
        await db.rollback()
        await db.execute(delete(SignInLog).where(SignInLog.user_id == uid))
        await db.commit()
        await _cleanup(db, a, u)
