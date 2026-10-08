"""
Phase 14 — Ask AI. Real app, Postgres and Redis; Gemini is mocked with respx and TMDB lookups are
stubbed, so nothing here needs a key or a network.
"""
import json
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.models.watchlist_item import WatchlistItem
from app.schemas.media import MovieDetail, TVShowDetail
from app.services import ai_service, auth_service, tmdb_service

pytestmark = pytest.mark.asyncio
settings = get_settings()
GEMINI = f"{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent"
FALLBACK = f"{settings.gemini_base_url}/models/{settings.gemini_fallback_model}:generateContent"

CATALOG = {
    ("Lost in Translation", "movie"): (153, "2003"),
    ("Her", "movie"): (152, "2013"),
    ("Past Lives", "movie"): (666277, "2023"),
    ("Station Eleven", "tv"): (85552, "2021"),
}


def gemini_reply(for_you=(), general=(), note=None):
    payload = {"for_you": list(for_you), "general": list(general)}
    if note:
        payload["note"] = note
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]})


def s(title, year, type="movie", reason="Quiet and tender"):
    return {"title": title, "year": year, "type": type, "reason": reason}


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for pattern in ("ai:*", "tmdb:*"):
        for k in await redis.keys(pattern):
            await redis.delete(k)
    yield
    await redis.aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
def stubs(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")

    async def find_title(title, year, media_type):
        hit = CATALOG.get((title, media_type))
        return hit[0] if hit else None

    def detail(tmdb_id, media_type):
        name = next(t for (t, m), (i, _) in CATALOG.items() if i == tmdb_id and m == media_type)
        year = CATALOG[(name, media_type)][1]
        common = dict(tmdb_id=tmdb_id, title=name, overview=f"About {name}", year=year, genres=["Drama"], rating=7.9, trailer_key="yt123")
        return MovieDetail(**common, runtime_minutes=102) if media_type == "movie" else TVShowDetail(**common, seasons=[])

    async def get_movie(i):
        return detail(i, "movie")

    async def get_tv(i):
        return detail(i, "tv")

    monkeypatch.setattr(tmdb_service, "find_title", find_title)
    monkeypatch.setattr(tmdb_service, "get_movie", get_movie)
    monkeypatch.setattr(tmdb_service, "get_tv", get_tv)


async def _client(is_admin=False, **fields):
    username = f"ai_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, username, "AI Tester", "testpass123", is_admin=is_admin)
        for k, v in fields.items():
            setattr(user, k, v)
        await db.commit()
        token = await auth_service.create_session(user.id)
        uid = user.id
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    c.cookies.set(SESSION_COOKIE_NAME, token)
    return c, username, uid


async def _drop(c, username):
    await c.aclose()
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, username)
        if u:
            await db.delete(u)
            await db.commit()


@pytest.fixture
async def person():
    c, name, uid = await _client()
    c.uid = uid
    yield c
    await _drop(c, name)


@pytest.fixture
async def admin():
    c, name, _ = await _client(is_admin=True)
    yield c
    await _drop(c, name)


class TestAllowance:
    async def test_status_shows_five_a_day_for_a_person_and_no_limit_for_an_admin(self, person, admin):
        body = (await person.get("/api/ai/status")).json()
        assert body == {"enabled": True, "limit": 5, "used": 0, "remaining": 5}
        assert (await admin.get("/api/ai/status")).json()["limit"] is None

    async def test_status_says_when_there_is_no_key(self, person, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "")
        assert (await person.get("/api/ai/status")).json()["enabled"] is False
        assert (await person.post("/api/ai/ask", json={"prompt": "something sad"})).status_code == 503

    @respx.mock
    async def test_the_limit_is_enforced_and_only_answers_count(self, person):
        async with AsyncSessionLocal() as db:
            u = await auth_service.get_user_by_id(db, person.uid)
            u.ai_daily_limit = 2
            await db.commit()
        route = respx.post(GEMINI).mock(side_effect=[gemini_reply(general=[s("Her", 2013)]), httpx.Response(500), httpx.Response(500), gemini_reply(general=[s("Her", 2013)]), gemini_reply(general=[s("Her", 2013)])])
        respx.post(FALLBACK).mock(return_value=httpx.Response(500))
        assert (await person.post("/api/ai/ask", json={"prompt": "first thing"})).status_code == 200
        # two failed tries cost nothing
        assert (await person.post("/api/ai/ask", json={"prompt": "second thing"})).status_code == 503
        assert (await person.get("/api/ai/status")).json()["remaining"] == 1
        assert (await person.post("/api/ai/ask", json={"prompt": "second thing"})).status_code == 503
        assert (await person.post("/api/ai/ask", json={"prompt": "second thing"})).status_code == 200
        res = await person.post("/api/ai/ask", json={"prompt": "third thing"})
        assert res.status_code == 429 and "2 AI searches" in res.json()["detail"]
        assert route.call_count == 4

    @respx.mock
    async def test_zero_switches_it_off_and_an_admin_is_never_limited(self, admin):
        respx.post(GEMINI).mock(return_value=gemini_reply(general=[s("Her", 2013)]))
        for i in range(7):
            assert (await admin.post("/api/ai/ask", json={"prompt": f"movie number {i}"})).status_code == 200
        assert (await admin.post("/api/ai/ask", json={"prompt": "one more"})).json()["remaining"] is None

    async def test_zero_means_off(self):
        c, name, _ = await _client(ai_daily_limit=0)
        try:
            res = await c.post("/api/ai/ask", json={"prompt": "something sad"})
            assert res.status_code == 403
        finally:
            await _drop(c, name)

    async def test_requires_login(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/ai/status")).status_code == 401
            assert (await c.post("/api/ai/ask", json={"prompt": "sad movie"})).status_code == 401


class TestAsk:
    @respx.mock
    async def test_suggestions_become_real_titles_in_two_lists_with_the_note(self, person):
        respx.post(GEMINI).mock(
            return_value=gemini_reply(
                for_you=[s("Lost in Translation", 2003), s("Made Up Film That Does Not Exist", 2019)],
                general=[s("Past Lives", 2023), s("Station Eleven", 2021, "tv")],
                note="Leaning gentle rather than bleak.",
            )
        )
        body = (await person.post("/api/ai/ask", json={"prompt": "sad movie about a lonely girl"})).json()
        assert body["note"] == "Leaning gentle rather than bleak."
        assert [t["title"] for t in body["for_you"]] == ["Lost in Translation"]  # the invented one is dropped
        lost = body["for_you"][0]
        assert (lost["tmdb_id"], lost["media_type"], lost["runtime_minutes"], lost["trailer_key"], lost["reason"]) == (153, "movie", 102, "yt123", "Quiet and tender")
        assert [t["title"] for t in body["general"]] == ["Past Lives", "Station Eleven"]
        assert body["general"][1]["media_type"] == "tv" and body["general"][1]["seasons"] == 0
        assert body["remaining"] == 4 and body["limit"] == 5

    @respx.mock
    async def test_only_titles_and_years_are_sent_and_watched_ones_are_never_suggested(self, person):
        async with AsyncSessionLocal() as db:
            db.add(WatchlistItem(user_id=person.uid, tmdb_id=152, media_type="movie"))  # "Her", saved
            await db.commit()
        route = respx.post(GEMINI).mock(return_value=gemini_reply(for_you=[s("Her", 2013), s("Past Lives", 2023)], general=[s("Her", 2013)]))
        body = (await person.post("/api/ai/ask", json={"prompt": "something tender"})).json()
        sent = route.calls[0].request.content.decode()
        assert "Her (2013) [movie]" in sent and "AI Tester" not in sent and "ai_" not in sent.split("REQUEST")[1].split("WATCHED")[0]
        assert [t["title"] for t in body["for_you"]] == ["Past Lives"]
        assert body["general"] == []  # the saved title is excluded there too
        assert body["used_history"] is True

    @respx.mock
    async def test_history_can_be_switched_off(self, person):
        async with AsyncSessionLocal() as db:
            db.add(WatchlistItem(user_id=person.uid, tmdb_id=152, media_type="movie"))
            await db.commit()
        assert (await person.patch("/api/settings", json={"ai": {"use_history": False}})).status_code == 200
        route = respx.post(GEMINI).mock(return_value=gemini_reply(for_you=[s("Past Lives", 2023)], general=[s("Past Lives", 2023)]))
        body = (await person.post("/api/ai/ask", json={"prompt": "something tender"})).json()
        assert "Her (2013)" not in route.calls[0].request.content.decode()
        assert body["for_you"] == [] and body["used_history"] is False and len(body["general"]) == 1

    @respx.mock
    async def test_asking_the_same_thing_again_is_free(self, person):
        route = respx.post(GEMINI).mock(return_value=gemini_reply(general=[s("Her", 2013)]))
        await person.post("/api/ai/ask", json={"prompt": "Something tender"})
        again = (await person.post("/api/ai/ask", json={"prompt": "something   tender"})).json()
        assert route.call_count == 1 and again["remaining"] == 4

    @respx.mock
    async def test_a_busy_main_model_falls_back_to_the_lighter_one(self, person):
        respx.post(GEMINI).mock(return_value=httpx.Response(429))
        respx.post(FALLBACK).mock(return_value=gemini_reply(general=[s("Her", 2013)]))
        res = await person.post("/api/ai/ask", json={"prompt": "something tender"})
        assert res.status_code == 200 and res.json()["general"][0]["title"] == "Her"

    @respx.mock
    async def test_nothing_findable_is_an_error_and_costs_nothing(self, person):
        respx.post(GEMINI).mock(return_value=gemini_reply(general=[s("Totally Invented", 2001)]))
        res = await person.post("/api/ai/ask", json={"prompt": "something tender"})
        assert res.status_code == 502
        assert (await person.get("/api/ai/status")).json()["remaining"] == 5

    @respx.mock
    async def test_garbled_answers_are_handled(self, person):
        respx.post(GEMINI).mock(return_value=httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}))
        respx.post(FALLBACK).mock(return_value=httpx.Response(200, json={}))
        assert (await person.post("/api/ai/ask", json={"prompt": "something tender"})).status_code == 502

    async def test_prompt_is_checked(self, person):
        assert (await person.post("/api/ai/ask", json={"prompt": "hi"})).status_code == 422
        assert (await person.post("/api/ai/ask", json={"prompt": "x" * 401})).status_code == 422


class TestFindTitle:
    @respx.mock
    async def test_prefers_the_exact_title_near_the_year_and_skips_the_rest(self, monkeypatch):
        monkeypatch.undo()  # the real function, not the stub
        monkeypatch.setattr(settings, "tmdb_api_key", "k")
        redis_module._redis_client = None
        for k in await redis_module.get_redis().keys("tmdb:*"):
            await redis_module.get_redis().delete(k)
        respx.get(f"{settings.tmdb_base_url}/search/movie").mock(
            return_value=httpx.Response(
                200,
                json={"results": [
                    {"id": 1, "title": "Her Smell", "release_date": "2018-01-01", "popularity": 50},
                    {"id": 2, "title": "Her", "release_date": "2013-12-18", "popularity": 20},
                    {"id": 3, "title": "Her", "release_date": "1999-01-01", "popularity": 99},
                ]},
            )
        )
        assert await tmdb_service.find_title("Her", 2013, "movie") == 2
        assert await tmdb_service.find_title("Nothing Like It", 2013, "movie") is None


class TestAdminSetsTheLimit:
    async def test_an_admin_can_set_reset_and_switch_off_one_persons_limit(self, admin, person):
        url = f"/api/admin/users/{person.uid}"
        assert (await admin.patch(url, json={"ai_daily_limit": 12})).json()["ai_daily_limit"] == 12
        assert (await person.get("/api/ai/status")).json()["limit"] == 12
        # sending something else leaves it alone
        assert (await admin.patch(url, json={"display_name": "Renamed"})).json()["ai_daily_limit"] == 12
        # null = back to the site default
        assert (await admin.patch(url, json={"ai_daily_limit": None})).json()["ai_daily_limit"] is None
        assert (await person.get("/api/ai/status")).json()["limit"] == 5
        assert (await admin.patch(url, json={"ai_daily_limit": 0})).json()["ai_daily_limit"] == 0
        assert (await admin.patch(url, json={"ai_daily_limit": -1})).status_code == 422

    async def test_a_regular_person_cannot_change_it(self, person):
        assert (await person.patch(f"/api/admin/users/{person.uid}", json={"ai_daily_limit": 99})).status_code == 403
