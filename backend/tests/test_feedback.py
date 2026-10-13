"""Feedback from Settings: people send it, admins read it, mark it handled, delete it."""
import uuid

import pytest
from sqlalchemy import delete

from app.models.feedback import Feedback
from app.services import telegram_service
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


@pytest.fixture(autouse=True)
def reports(monkeypatch):
    seen = []
    monkeypatch.setattr(telegram_service, "report_feedback", lambda *a: seen.append(a))
    return seen


async def _purge(db, *user_ids):
    await db.rollback()
    await db.execute(delete(Feedback).where(Feedback.user_id.in_(user_ids)))
    await db.commit()


async def test_needs_sign_in_and_admin(client, db):
    assert (await client.post("/api/feedback", json={"message": "hi"})).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        assert (await client.get("/api/admin/feedback")).status_code == 403
        assert (await client.post(f"/api/admin/feedback/{uuid.uuid4()}/handled")).status_code == 403
        assert (await client.delete(f"/api/admin/feedback/{uuid.uuid4()}")).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_send_list_handle_delete(client, db, reports):
    user, name, token = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, token)
        r = await client.post("/api/feedback", json={"kind": "problem", "message": "  Subtitles are early  ", "page": "/watch/movie/1"})
        assert r.status_code == 201
        assert reports and reports[0][1] == "problem" and reports[0][2] == "Subtitles are early"
        assert (await client.post("/api/feedback", json={"message": "   "})).status_code == 422
        assert (await client.post("/api/feedback", json={"kind": "nope", "message": "x"})).status_code == 422

        as_(client, atoken)
        page = (await client.get("/api/admin/feedback")).json()
        mine = [i for i in page["items"] if i["author_id"] == str(user.id)]
        assert len(mine) == 1 and mine[0]["message"] == "Subtitles are early" and mine[0]["handled"] is False
        assert mine[0]["page"] == "/watch/movie/1" and mine[0]["author_name"] == user.display_name
        before = page["unhandled"]
        fid = mine[0]["id"]

        assert (await client.post(f"/api/admin/feedback/{fid}/handled")).status_code == 204
        after = (await client.get("/api/admin/feedback?handled=false")).json()
        assert after["unhandled"] == before - 1 and fid not in [i["id"] for i in after["items"]]
        assert fid in [i["id"] for i in (await client.get("/api/admin/feedback?handled=true")).json()["items"]]
        assert (await client.post(f"/api/admin/feedback/{fid}/handled?handled=false")).status_code == 204
        assert (await client.post(f"/api/admin/feedback/{uuid.uuid4()}/handled")).status_code == 404

        assert (await client.delete(f"/api/admin/feedback/{fid}")).status_code == 204
        assert fid not in [i["id"] for i in (await client.get("/api/admin/feedback")).json()["items"]]
    finally:
        await _purge(db, user.id, admin.id)
        await _cleanup(db, name, aname)


async def test_daily_limit(client, db):
    user, name, token = await _make(db)
    try:
        as_(client, token)
        for _ in range(10):
            assert (await client.post("/api/feedback", json={"message": "again"})).status_code == 201
        assert (await client.post("/api/feedback", json={"message": "again"})).status_code == 429
    finally:
        await _purge(db, user.id)
        await _cleanup(db, name)


async def test_kept_with_name_after_account_deleted(client, db):
    user, name, token = await _make(db)
    admin, aname, atoken = await _make(db, is_admin=True)
    try:
        as_(client, token)
        await client.post("/api/feedback", json={"message": "bye"})
        shown = user.display_name
        await _cleanup(db, name)
        as_(client, atoken)
        items = (await client.get("/api/admin/feedback")).json()["items"]
        row = next(i for i in items if i["message"] == "bye" and i["author_id"] is None)
        assert row["author_name"] == shown
        await db.execute(delete(Feedback).where(Feedback.id == uuid.UUID(row["id"])))
        await db.commit()
    finally:
        await _cleanup(db, aname)


def test_production_refuses_placeholder_secret():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", session_secret="change-me-in-env")
    with pytest.raises(ValidationError):
        Settings(environment="production", session_secret="short")
    assert Settings(environment="production", session_secret="x" * 32).environment == "production"
    assert Settings(environment="development").session_secret == "change-me-in-env"
