"""Phase 10c: admin messages with "I understand" and acceptance stats."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.announcement import Announcement
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

ADMIN_ROUTES = [
    ("get", "/api/admin/announcements"),
    ("post", "/api/admin/announcements"),
    ("get", f"/api/admin/announcements/{uuid.uuid4()}"),
    ("patch", f"/api/admin/announcements/{uuid.uuid4()}"),
    ("post", f"/api/admin/announcements/{uuid.uuid4()}/reshow"),
    ("delete", f"/api/admin/announcements/{uuid.uuid4()}"),
]


async def _purge(db, *ids):
    await db.rollback()
    for i in ids:
        a = await db.get(Announcement, uuid.UUID(i))
        if a:
            await db.delete(a)
    await db.commit()


async def _send(client, token, **over):
    as_(client, token)
    body = {"title": "Maintenance", "body": "Back at 9.", "audience": "all", **over}
    r = await client.post("/api/admin/announcements", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_admin_routes_are_admin_only(client, db):
    for method, url in ADMIN_ROUTES:
        client.cookies.clear()
        assert (await getattr(client, method)(url)).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        for method, url in ADMIN_ROUTES:
            assert (await getattr(client, method)(url)).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_people_routes_need_login(client):
    assert (await client.get("/api/announcements/pending")).status_code == 401
    assert (await client.post(f"/api/announcements/{uuid.uuid4()}/ack")).status_code == 401


async def test_everyone_message_shows_until_accepted_and_stats_follow(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, ot = await _make(db)
    two, t, tt = await _make(db)
    ann_id = None
    try:
        made = await _send(client, at)
        ann_id = made["id"]
        assert made["status"] == "active" and made["created_by_name"] == admin.display_name
        assert made["recipients"] >= 3 and made["accepted"] == 0

        as_(client, ot)
        pending = (await client.get("/api/announcements/pending")).json()
        assert [p["id"] for p in pending if p["id"] == ann_id] == [ann_id]
        assert (await client.post(f"/api/announcements/{ann_id}/ack")).status_code == 204
        assert (await client.post(f"/api/announcements/{ann_id}/ack")).status_code == 204  # idempotent
        assert ann_id not in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]

        as_(client, tt)
        assert ann_id in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]  # still unread

        as_(client, at)
        d = (await client.get(f"/api/admin/announcements/{ann_id}")).json()
        assert d["accepted"] == 1
        by_name = {p["username"]: p for p in d["people"]}
        assert by_name[o]["acked_at"] is not None and by_name[t]["acked_at"] is None
        assert d["people"][0]["acked_at"] is not None  # accepted people are listed first
        listed = next(x for x in (await client.get("/api/admin/announcements")).json() if x["id"] == ann_id)
        assert listed["accepted"] == 1

        r = await client.post(f"/api/admin/announcements/{ann_id}/reshow")
        assert r.json() == {"cleared": 1}
        as_(client, ot)
        assert ann_id in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
    finally:
        await _purge(db, *([ann_id] if ann_id else []))
        await _cleanup(db, a, o, t)


async def test_selected_message_only_reaches_chosen_people(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, ot = await _make(db)
    two, t, tt = await _make(db)
    ann_id = None
    try:
        made = await _send(client, at, audience="selected", user_ids=[str(one.id)])
        ann_id = made["id"]
        assert made["recipients"] == 1
        as_(client, ot)
        assert ann_id in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
        as_(client, tt)
        assert ann_id not in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
        assert (await client.post(f"/api/announcements/{ann_id}/ack")).status_code == 404  # not meant for them
        as_(client, at)
        assert (await client.get(f"/api/admin/announcements/{ann_id}/targets")).json() == [str(one.id)]
        # change the audience to both people
        r = await client.patch(f"/api/admin/announcements/{ann_id}", json={"user_ids": [str(one.id), str(two.id)]})
        assert r.json()["recipients"] == 2
        as_(client, tt)
        assert ann_id in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
        # switching to everyone drops the target list
        as_(client, at)
        r = await client.patch(f"/api/admin/announcements/{ann_id}", json={"audience": "all"})
        assert r.json()["audience"] == "all"
        assert (await client.get(f"/api/admin/announcements/{ann_id}/targets")).json() == []
        # and back to selected needs people
        assert (await client.patch(f"/api/admin/announcements/{ann_id}", json={"audience": "selected"})).status_code == 422
    finally:
        await _purge(db, *([ann_id] if ann_id else []))
        await _cleanup(db, a, o, t)


async def test_validation(client, db):
    admin, a, at = await _make(db, is_admin=True)
    try:
        as_(client, at)
        post = lambda **kw: client.post("/api/admin/announcements", json={"title": "T", "body": "B", **kw})
        assert (await post(title="   ")).status_code == 422
        assert (await post(body="")).status_code == 422
        assert (await post(title="x" * 121)).status_code == 422
        assert (await post(audience="selected")).status_code == 422  # nobody picked
        assert (await post(audience="selected", user_ids=[str(uuid.uuid4())])).status_code == 422  # unknown person
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert (await post(expires_at=past)).status_code == 422
        assert (await client.get(f"/api/admin/announcements/{uuid.uuid4()}")).status_code == 404
        assert (await client.delete(f"/api/admin/announcements/{uuid.uuid4()}")).status_code == 404
    finally:
        await _cleanup(db, a)


async def test_expiry_stop_edit_and_delete(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, ot = await _make(db)
    ann_id = None
    try:
        soon = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        made = await _send(client, at, expires_at=soon)
        ann_id = made["id"]
        as_(client, ot)
        assert ann_id in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]

        # the end time passes -> hidden and listed as expired
        row = await db.get(Announcement, uuid.UUID(ann_id))
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db.commit()
        assert ann_id not in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
        as_(client, at)
        assert next(x for x in (await client.get("/api/admin/announcements")).json() if x["id"] == ann_id)["status"] == "expired"

        # extend it again, edit the text, then stop it
        r = await client.patch(f"/api/admin/announcements/{ann_id}", json={"expires_at": None, "title": "  New title ", "body": "New body"})
        assert r.json()["status"] == "active" and r.json()["title"] == "New title" and r.json()["expires_at"] is None
        as_(client, ot)
        shown = [p for p in (await client.get("/api/announcements/pending")).json() if p["id"] == ann_id]
        assert shown and shown[0]["body"] == "New body"
        as_(client, at)
        r = await client.patch(f"/api/admin/announcements/{ann_id}", json={"is_active": False})
        assert r.json()["status"] == "stopped"
        as_(client, ot)
        assert ann_id not in [p["id"] for p in (await client.get("/api/announcements/pending")).json()]
        as_(client, at)
        assert (await client.patch(f"/api/admin/announcements/{ann_id}", json={"expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()})).status_code == 422

        assert (await client.delete(f"/api/admin/announcements/{ann_id}")).status_code == 204
        assert (await client.get(f"/api/admin/announcements/{ann_id}")).status_code == 404
        ann_id = None
    finally:
        await _purge(db, *([ann_id] if ann_id else []))
        await _cleanup(db, a, o)


async def test_disabled_people_are_not_counted_for_everyone_messages(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, _ = await _make(db)
    ann_id = None
    try:
        before = (await _send(client, at))
        ann_id = before["id"]
        one.is_disabled = True
        await db.commit()
        after = (await client.get(f"/api/admin/announcements/{ann_id}")).json()
        assert after["recipients"] == before["recipients"] - 1
        assert o not in [p["username"] for p in after["people"]]
    finally:
        await _purge(db, *([ann_id] if ann_id else []))
        await _cleanup(db, a, o)


async def test_deleting_a_person_removes_their_acceptance(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, ot = await _make(db)
    ann_id = None
    try:
        ann_id = (await _send(client, at))["id"]
        as_(client, ot)
        await client.post(f"/api/announcements/{ann_id}/ack")
        await _cleanup(db, o)
        as_(client, at)
        assert (await client.get(f"/api/admin/announcements/{ann_id}")).json()["accepted"] == 0
    finally:
        await _purge(db, *([ann_id] if ann_id else []))
        await _cleanup(db, a)
