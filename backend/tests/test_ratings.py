"""
Phase 12 — IMDb / Rotten Tomatoes / Metacritic scores from OMDb.
Real app, real Postgres/Redis; TMDB (for the IMDb id) and OMDb are mocked with respx.
"""
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
from app.services import auth_service
from app.services.ratings_service import parse_omdb

pytestmark = pytest.mark.asyncio
settings = get_settings()

OMDB = "https://www.omdbapi.com/"
FULL = {
    "Response": "True",
    "imdbRating": "8.7",
    "imdbVotes": "2,100,345",
    "Metascore": "73",
    "Ratings": [
        {"Source": "Internet Movie Database", "Value": "8.7/10"},
        {"Source": "Rotten Tomatoes", "Value": "83%"},
        {"Source": "Metacritic", "Value": "73/100"},
    ],
}


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for pattern in ("ratings:*", "tmdb:*"):
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
def key(monkeypatch):
    monkeypatch.setattr(settings, "omdb_api_key", "test-omdb-key")


@pytest.fixture
async def authed():
    username = f"rate_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, username, "Rate Tester", "testpass123")
        token = await auth_service.create_session(user.id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.cookies.set(SESSION_COOKIE_NAME, token)
        yield c
    async with AsyncSessionLocal() as db:
        u = await auth_service.get_user_by_username(db, username)
        if u:
            await db.delete(u)
            await db.commit()


def tmdb_movie(imdb="tt0133093", tmdb_id=603):
    respx.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}").mock(
        return_value=httpx.Response(200, json={"id": tmdb_id, "imdb_id": imdb})
    )


class TestParse:
    def test_reads_all_three(self):
        r = {x.source: x for x in parse_omdb(FULL, "tt1")}
        assert (r["imdb"].display, r["imdb"].suffix, r["imdb"].votes) == ("8.7", "/10", 2100345)
        assert r["imdb"].url == "https://www.imdb.com/title/tt1/"
        assert (r["rotten_tomatoes"].display, r["rotten_tomatoes"].suffix) == ("83%", "")
        assert (r["metacritic"].display, r["metacritic"].suffix) == ("73", "/100")

    def test_leaves_out_what_is_missing(self):
        data = {"imdbRating": "N/A", "imdbVotes": "N/A", "Ratings": [{"Source": "Rotten Tomatoes", "Value": "N/A"}]}
        assert parse_omdb(data, "tt1") == []

    def test_metascore_is_a_fallback(self):
        assert [r.source for r in parse_omdb({"Metascore": "61", "Ratings": []}, "tt1")] == ["metacritic"]


class TestRoute:
    async def test_requires_auth(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/ratings/movie/603")).status_code == 401

    async def test_bad_media_type(self, authed):
        assert (await authed.get("/api/ratings/album/603")).status_code == 400

    @respx.mock
    async def test_returns_scores_and_caches_them(self, authed):
        tmdb_movie()
        omdb = respx.get(OMDB).mock(return_value=httpx.Response(200, json=FULL))
        body = (await authed.get("/api/ratings/movie/603")).json()
        assert body["configured"] is True
        assert [r["source"] for r in body["ratings"]] == ["imdb", "rotten_tomatoes", "metacritic"]
        assert omdb.calls[0].request.url.params["i"] == "tt0133093"
        again = (await authed.get("/api/ratings/movie/603")).json()
        assert again == body
        assert omdb.call_count == 1  # second answer came from the cache

    @respx.mock
    async def test_tv_uses_external_ids(self, authed):
        respx.get("https://api.themoviedb.org/3/tv/1396/external_ids").mock(return_value=httpx.Response(200, json={"imdb_id": "tt0903747"}))
        respx.get(OMDB).mock(return_value=httpx.Response(200, json=FULL))
        assert len((await authed.get("/api/ratings/tv/1396")).json()["ratings"]) == 3

    async def test_without_a_key_it_says_so(self, authed, monkeypatch):
        monkeypatch.setattr(settings, "omdb_api_key", "")
        assert (await authed.get("/api/ratings/movie/603")).json() == {"ratings": [], "configured": False}

    @respx.mock
    async def test_no_imdb_id_is_empty_not_an_error(self, authed):
        tmdb_movie(imdb=None)
        omdb = respx.get(OMDB).mock(return_value=httpx.Response(200, json=FULL))
        r = await authed.get("/api/ratings/movie/603")
        assert r.status_code == 200 and r.json()["ratings"] == []
        assert omdb.call_count == 0

    @respx.mock
    async def test_omdb_trouble_is_empty_not_an_error(self, authed):
        tmdb_movie()
        respx.get(OMDB).mock(return_value=httpx.Response(401, json={"Response": "False", "Error": "Invalid API key!"}))
        r = await authed.get("/api/ratings/movie/603")
        assert r.status_code == 200 and r.json() == {"ratings": [], "configured": True}

    @respx.mock
    async def test_unknown_title_and_daily_limit_are_empty(self, authed):
        tmdb_movie()
        respx.get(OMDB).mock(return_value=httpx.Response(200, json={"Response": "False", "Error": "Request limit reached!"}))
        assert (await authed.get("/api/ratings/movie/603")).json()["ratings"] == []

    @respx.mock
    async def test_network_failure_is_empty(self, authed):
        tmdb_movie()
        respx.get(OMDB).mock(side_effect=httpx.ConnectError("down"))
        assert (await authed.get("/api/ratings/movie/603")).json()["ratings"] == []
