"""Age limits: lists are filtered, single titles refuse, and unlimited accounts are untouched."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.schemas.media import MediaItem, MovieDetail
from app.services import auth_service, content_rating_service as cr, tmdb_service

pytestmark = pytest.mark.asyncio

CERTS = {
    ("movie", 1): "G", ("movie", 2): "PG", ("movie", 3): "PG-13", ("movie", 4): "R", ("movie", 5): "NC-17",
    ("movie", 6): None, ("movie", 7): "NR",
    ("tv", 10): "TV-Y7", ("tv", 11): "TV-PG", ("tv", 12): "TV-14", ("tv", 13): "TV-MA",
    ("movie", 8): "G",  # rated G but flagged adult by TMDB
}
ADULT = {("movie", 8)}


def item(kind, i):
    return MediaItem(tmdb_id=i, media_type=kind, title=f"{kind}{i}")


@pytest.fixture(autouse=True)
async def env(monkeypatch):
    redis_module._redis_client = None
    redis_module.get_redis()

    async def cert(kind, i):
        return CERTS.get((kind, i))

    async def adult(kind, i):
        return (kind, i) in ADULT

    async def trending(window="day"):
        return [item("movie", i) for i in (1, 2, 3, 4, 5, 6, 7, 8)] + [item("tv", i) for i in (10, 11, 12, 13)]

    async def movie(i):
        return MovieDetail(tmdb_id=i, title=f"m{i}", overview="x")

    monkeypatch.setattr(tmdb_service, "get_certification", cert)
    monkeypatch.setattr(tmdb_service, "is_adult_flagged", adult)
    monkeypatch.setattr(tmdb_service, "get_trending", trending)
    monkeypatch.setattr(tmdb_service, "get_movie", movie)
    yield
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def make(limit=None, is_admin=False):
    name = f"age_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        u = await auth_service.create_user(db, name, name.title(), "password123", is_admin=is_admin, age_limit=limit)
        return u.id


async def as_user(client, uid):
    client.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))


def ids(rows):
    return {(r["media_type"], r["tmdb_id"]) for r in rows}


async def test_each_limit_lets_through_its_own_ratings_and_milder_ones(client):
    expected = {
        "G": {("movie", 1), ("tv", 10)},
        "PG": {("movie", 1), ("movie", 2), ("tv", 10), ("tv", 11)},
        "PG-13": {("movie", 1), ("movie", 2), ("movie", 3), ("tv", 10), ("tv", 11), ("tv", 12)},
        "R": {("movie", 1), ("movie", 2), ("movie", 3), ("movie", 4), ("tv", 10), ("tv", 11), ("tv", 12), ("tv", 13)},
    }
    for limit, shown in expected.items():
        await as_user(client, await make(limit))
        got = ids((await client.get("/api/trending")).json())
        assert got == shown, limit


async def test_unrated_nc17_and_adult_flagged_titles_are_hidden_from_limited_accounts(client):
    await as_user(client, await make("R"))
    got = ids((await client.get("/api/trending")).json())
    assert not got & {("movie", 5), ("movie", 6), ("movie", 7), ("movie", 8)}


async def test_an_account_without_a_limit_sees_everything_and_costs_no_rating_lookups(client, monkeypatch):
    calls = []

    async def spy(kind, i):
        calls.append((kind, i))

    monkeypatch.setattr(tmdb_service, "get_certification", spy)
    await as_user(client, await make(None))
    assert len((await client.get("/api/trending")).json()) == 12
    assert calls == []


async def test_a_single_title_above_the_limit_is_refused(client):
    await as_user(client, await make("PG"))
    assert (await client.get("/api/movies/2")).status_code == 200
    blocked = await client.get("/api/movies/4")
    assert blocked.status_code == 403 and "isn't available" in blocked.json()["detail"]
    assert (await client.get("/api/movies/4/similar")).status_code == 403
    assert (await client.get("/api/tv/13/season/1")).status_code == 403


async def test_playback_and_the_rest_refuse_too(client):
    await as_user(client, await make("PG"))
    for url in (
        "/api/playback/movie/4",
        "/api/playback/tv/13/1/1",
        "/api/ratings/movie/4",
        "/api/segments?media_type=movie&tmdb_id=4",
        "/api/subtitles/search?media_type=movie&tmdb_id=4",
        "/api/subtitle-sync/status?media_type=movie&tmdb_id=4&subtitle_url=/subtitle-cache/x.srt",
    ):
        assert (await client.get(url)).status_code == 403, url
    for url, body in (
        ("/api/watch-progress", {"tmdb_id": 4, "media_type": "movie", "position_seconds": 5, "duration_seconds": 100}),
        ("/api/watch-progress/movie/visit", {"tmdb_id": 4}),
        ("/api/watchlist", {"tmdb_id": 4, "media_type": "movie"}),
        ("/api/ai/watch/ask", {"media_type": "movie", "tmdb_id": 4, "question": "recap?"}),
    ):
        assert (await client.post(url, json=body)).status_code == 403, url


async def test_media_routes_need_a_signed_in_person(client):
    assert (await client.get("/api/trending")).status_code == 401
    assert (await client.get("/api/movies/1")).status_code == 401


async def test_admins_create_and_change_limits_but_admins_cannot_have_one(client):
    admin = await make(None, is_admin=True)
    await as_user(client, admin)
    made = await client.post("/api/admin/users", json={"username": f"kid_{uuid.uuid4().hex[:6]}", "display_name": "Kid", "password": "password123", "age_limit": "PG-13"})
    assert made.status_code == 201 and made.json()["age_limit"] == "PG-13"
    kid = made.json()["id"]
    assert (await client.post("/api/admin/users", json={"username": f"x_{uuid.uuid4().hex[:6]}", "display_name": "X", "password": "password123", "is_admin": True, "age_limit": "G"})).status_code == 400
    assert (await client.patch(f"/api/admin/users/{kid}", json={"age_limit": "G"})).json()["age_limit"] == "G"
    assert (await client.patch(f"/api/admin/users/{kid}", json={"is_admin": True})).status_code == 400
    assert (await client.patch(f"/api/admin/users/{kid}", json={"age_limit": None})).json()["age_limit"] is None
    assert (await client.patch(f"/api/admin/users/{kid}", json={"age_limit": "XXX"})).status_code == 422


async def test_ask_ai_drops_titles_above_the_limit(monkeypatch):
    from app.services import ai_service

    ids_by_title = {"Kidfilm": 1, "Gorefest": 4}

    async def find(title, year, kind):
        return ids_by_title[title]

    monkeypatch.setattr(tmdb_service, "find_title", find)

    async def get_movie(i):
        return MovieDetail(tmdb_id=i, title=f"m{i}", overview="x")

    monkeypatch.setattr(tmdb_service, "get_movie", get_movie)
    async with AsyncSessionLocal() as db:
        u = await auth_service.create_user(db, f"ai_{uuid.uuid4().hex[:8]}", "Kid", "password123", age_limit="PG")
    sugg = [ai_service._Suggestion(title="Kidfilm", year=2020, type="movie", reason="a"), ai_service._Suggestion(title="Gorefest", year=2020, type="movie", reason="b")]
    out = await ai_service._resolve(u, sugg, set(), set())
    assert [t.tmdb_id for t in out] == [1]
