"""Phase 10b: the lists behind every Overview number (admin-only)."""
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import update

from app.models.watch_progress import WatchProgress
from app.services import watch_progress_service
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

ROUTES = [
    "/api/admin/titles",
    "/api/admin/titles/movie/603/viewers",
    "/api/admin/activity/2026-10-04",
    "/api/admin/sign-ins",
]


async def test_routes_need_admin(client, db):
    for r in ROUTES:
        client.cookies.clear()
        assert (await client.get(r)).status_code == 401
    user, name, token = await _make(db)
    try:
        as_(client, token)
        for r in ROUTES:
            assert (await client.get(r)).status_code == 403
    finally:
        await _cleanup(db, name)


async def test_titles_viewers_and_day(client, db):
    admin, a, at = await _make(db, is_admin=True)
    one, o, _ = await _make(db)
    two, t, _ = await _make(db)
    tmdb = 900000 + uuid.uuid4().int % 90000
    try:
        await watch_progress_service.save_progress(db, one.id, tmdb, "movie", None, None, 600.0, 1200.0)
        await watch_progress_service.save_progress(db, two.id, tmdb, "movie", None, None, 1200.0, 1200.0)
        await watch_progress_service.save_progress(db, one.id, tmdb + 1, "tv", 1, 2, 10.0, 100.0)
        as_(client, at)

        page = (await client.get("/api/admin/titles?limit=200")).json()
        row = next(r for r in page["items"] if r["tmdb_id"] == tmdb)
        assert row["viewers"] == 2 and row["entries"] == 2 and row["title"] == f"Movie {tmdb}"
        assert page["total"] >= 2
        assert [r["viewers"] for r in page["items"]] == sorted((r["viewers"] for r in page["items"]), reverse=True)

        v = (await client.get(f"/api/admin/titles/movie/{tmdb}/viewers")).json()
        assert v["total"] == 2
        assert {i["username"] for i in v["items"]} == {o, t}
        assert {round(i["fraction"], 2) for i in v["items"]} == {0.5, 1.0}
        assert (await client.get(f"/api/admin/titles/book/{tmdb}/viewers")).status_code == 422

        today = datetime.now(timezone.utc).date().isoformat()
        d = (await client.get(f"/api/admin/activity/{today}?limit=200")).json()
        assert {i["tmdb_id"] for i in d["items"]} >= {tmdb, tmdb + 1}
        tv = next(i for i in d["items"] if i["tmdb_id"] == tmdb + 1)
        assert tv["season_number"] == 1 and tv["episode_number"] == 2

        await db.execute(
            update(WatchProgress).where(WatchProgress.user_id == two.id).values(updated_at=datetime(2020, 1, 2, 12, tzinfo=timezone.utc))
        )
        await db.commit()
        old = (await client.get("/api/admin/activity/2020-01-02")).json()
        assert [i["username"] for i in old["items"]] == [t]
        assert (await client.get("/api/admin/activity/2020-01-03")).json() == {"items": [], "total": 0}
        assert (await client.get("/api/admin/activity/not-a-date")).status_code == 422
        assert (await client.get("/api/admin/titles?limit=500")).status_code == 422
    finally:
        await _cleanup(db, a, o, t)


async def test_sign_ins_lists_everyone_with_active_counts(client, db):
    admin, a, at = await _make(db, is_admin=True)  # _make opens one session
    other, o, _ = await _make(db)
    try:
        as_(client, at)
        rows = (await client.get("/api/admin/sign-ins")).json()
        mine = next(r for r in rows if r["id"] == str(admin.id))
        assert mine["active_sessions"] == 1
        assert {r["id"] for r in rows} >= {str(admin.id), str(other.id)}
        stamped = [r["last_login_at"] for r in rows if r["last_login_at"]]
        assert stamped == sorted(stamped, reverse=True)
        # people who never signed in come last
        seen_none = False
        for r in rows:
            seen_none = seen_none or r["last_login_at"] is None
            assert not (seen_none and r["last_login_at"] is not None)
    finally:
        await _cleanup(db, a, o)
