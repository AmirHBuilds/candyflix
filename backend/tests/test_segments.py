"""Skip-segment lookup: SkipDB first, IntroDB as the fallback (both mocked with respx)."""
import uuid

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

import app.core.redis as redis_module
from app.core.db import AsyncSessionLocal, engine
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service, segment_service, tmdb_service

pytestmark = pytest.mark.asyncio

SKIPDB = "https://api.skipdb.tv/api/segments"
INTRODB = "https://api.introdb.app/segments"


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis_module.get_redis()
    yield
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.fixture
def imdb():
    return f"tt{uuid.uuid4().int % 10**9:09d}"


def seg(start_ms, end_ms, **extra):
    return {"start_ms": start_ms, "end_ms": end_ms, "match": "exact", **extra}


def skipdb_body(intro=None, recap=None, outro=None):
    return {"imdb_id": "x", "segments": {"intro": intro, "recap": recap, "outro": outro, "preview": None}}


class TestLookup:
    @respx.mock
    async def test_skipdb_answers_in_seconds_and_credits_come_from_outro(self, imdb):
        s = respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000), seg(0, 4000), seg(2400000, 2500000))))
        i = respx.get(INTRODB).mock(return_value=httpx.Response(200, json={}))
        out = await segment_service.lookup(imdb, 1, 2, 2600.0)
        assert (out.intro.start, out.intro.end, out.intro.source) == (5.0, 95.0, "skipdb")
        assert (out.recap.start, out.recap.end) == (0.0, 4.0)
        assert (out.credits.start, out.credits.end) == (2400.0, 2500.0)
        assert s.called and not i.called  # nothing missing, so IntroDB isn't asked
        assert dict(s.calls[0].request.url.params) == {"imdb_id": imdb, "season": "1", "episode": "2", "duration": "2600.0"}

    @respx.mock
    async def test_introdb_fills_only_what_skipdb_lacks(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000))))
        i = respx.get(INTRODB).mock(
            return_value=httpx.Response(200, json={
                "intro": {"start_ms": 1000, "end_ms": 50000, "start_sec": 1, "end_sec": 50},
                "recap": None,
                "outro": {"start_ms": 2400000, "end_ms": 2500000, "start_sec": 2400, "end_sec": 2500},
            })
        )
        out = await segment_service.lookup(imdb, 1, 2, None)
        assert (out.intro.start, out.intro.source) == (5.0, "skipdb")  # SkipDB wins
        assert (out.credits.start, out.credits.source) == (2400.0, "introdb")
        assert out.recap is None
        assert dict(i.calls[0].request.url.params) == {"imdb_id": imdb, "season": "1", "episode": "2"}

    @respx.mock
    async def test_skipdb_nothing_then_introdb_for_a_movie(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(404))
        i = respx.get(INTRODB).mock(return_value=httpx.Response(200, json={"intro": {"start_sec": 10.5, "end_sec": 70}}))
        out = await segment_service.lookup(imdb, None, None, None)
        assert (out.intro.start, out.intro.end, out.intro.source) == (10.5, 70.0, "introdb")  # seconds-only form
        assert dict(i.calls[0].request.url.params) == {"imdb_id": imdb, "is_movie": "true"}

    @respx.mock
    async def test_skipdb_out_of_range_match_is_not_used(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body({**seg(5000, 95000), "match": "out-of-range"})))
        respx.get(INTRODB).mock(return_value=httpx.Response(404))
        out = await segment_service.lookup(imdb, 1, 1, 2600.0)
        assert out.intro is None

    @respx.mock
    @pytest.mark.parametrize(
        "bad",
        [
            seg(95000, 5000),  # ends before it starts
            seg(5000, 6000),  # 1 s: too short to be real
            seg(-1000, 50000),
            seg(0, 700000),  # a 700 s "intro"
            {"start_ms": "x", "end_ms": 5},
            "nope",
        ],
    )
    async def test_junk_is_ignored(self, imdb, bad):
        respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(bad)))
        respx.get(INTRODB).mock(return_value=httpx.Response(404))
        assert (await segment_service.lookup(imdb, 1, 1, None)).intro is None

    @respx.mock
    async def test_segments_outside_the_video_are_dropped_and_ends_are_clamped(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000), None, seg(2590000, 2700000))))
        respx.get(INTRODB).mock(return_value=httpx.Response(404))
        out = await segment_service.lookup(imdb, 1, 1, 2600.0)
        assert out.credits.end == 2600.0
        out2 = await segment_service.lookup(imdb, 1, 1, 60.0)  # a 60 s file can't contain credits at 2590 s
        assert out2.credits is None and out2.intro is not None

    @respx.mock
    async def test_a_failing_provider_falls_back_and_is_retried_soon(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(500))
        respx.get(INTRODB).mock(return_value=httpx.Response(200, json={"intro": {"start_ms": 1000, "end_ms": 50000}}))
        out = await segment_service.lookup(imdb, 1, 1, None)
        assert out.intro.source == "introdb"

    @respx.mock
    async def test_both_down_gives_nothing_and_a_short_cache(self, imdb):
        respx.get(SKIPDB).mock(side_effect=httpx.ConnectError("down"))
        respx.get(INTRODB).mock(return_value=httpx.Response(500))
        out = await segment_service.lookup(imdb, 1, 1, None)
        assert out.intro is None and out.recap is None and out.credits is None
        ttl = await redis_module.get_redis().ttl(segment_service._cache_key(imdb, 1, 1, None))
        assert 0 < ttl <= segment_service.ERROR_TTL

    @respx.mock
    async def test_garbage_json_counts_as_no_data(self, imdb):
        respx.get(SKIPDB).mock(return_value=httpx.Response(200, text="<html>"))
        respx.get(INTRODB).mock(return_value=httpx.Response(200, json=[1, 2]))
        assert (await segment_service.lookup(imdb, 1, 1, None)).intro is None

    @respx.mock
    async def test_results_are_cached_in_redis_only(self, imdb):
        s = respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000), seg(0, 4000), seg(2400000, 2500000))))
        first = await segment_service.lookup(imdb, 1, 1, 2600.0)
        second = await segment_service.lookup(imdb, 1, 1, 2601.0)  # same 10 s bucket
        assert first == second and s.call_count == 1
        await segment_service.lookup(imdb, 1, 1, 2000.0)  # a different file length asks again
        assert s.call_count == 2
        ttl = await redis_module.get_redis().ttl(segment_service._cache_key(imdb, 1, 1, 2600.0))
        assert 0 < ttl <= segment_service.HIT_TTL

    async def test_no_database_table_stores_segment_data(self):
        from app.core.db import Base

        names = " ".join(Base.metadata.tables)
        assert "segment" not in names and "skip" not in names


class TestRoute:
    @pytest.fixture
    async def client(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac

    @pytest.fixture
    async def login(self, client):
        name = f"seg_{uuid.uuid4().hex[:8]}"
        async with AsyncSessionLocal() as db:
            user = await auth_service.create_user(db, name, name.title(), "password123")
            uid = user.id
        client.cookies.set(SESSION_COOKIE_NAME, await auth_service.create_session(uid))
        yield
        async with AsyncSessionLocal() as db:
            u = await auth_service.get_user_by_username(db, name)
            if u:
                await db.delete(u)
                await db.commit()

    async def test_requires_login(self, client):
        assert (await client.get("/api/segments", params={"media_type": "movie", "tmdb_id": 603})).status_code == 401

    async def test_validates_the_request(self, client, login):
        assert (await client.get("/api/segments", params={"media_type": "book", "tmdb_id": 1})).status_code == 400
        assert (await client.get("/api/segments", params={"media_type": "tv", "tmdb_id": 1})).status_code == 422
        assert (await client.get("/api/segments", params={"media_type": "movie", "tmdb_id": 0})).status_code == 422

    async def test_looks_up_by_imdb_id_and_returns_the_segments(self, client, login, monkeypatch, imdb):
        async def tv_imdb(tmdb_id):
            assert tmdb_id == 1396
            return imdb

        monkeypatch.setattr(tmdb_service, "get_tv_imdb_id", tv_imdb)
        with respx.mock:
            respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000), seg(0, 4000), seg(2400000, 2500000))))
            res = await client.get(
                "/api/segments", params={"media_type": "tv", "tmdb_id": 1396, "season_number": 2, "episode_number": 5, "duration": 2600}
            )
        assert res.status_code == 200
        assert res.json()["intro"] == {"start": 5.0, "end": 95.0, "source": "skipdb"}
        assert res.json()["credits"]["start"] == 2400.0

    async def test_a_movie_ignores_any_season_and_episode(self, client, login, monkeypatch, imdb):
        async def movie_imdb(tmdb_id):
            return imdb

        monkeypatch.setattr(tmdb_service, "get_movie_imdb_id", movie_imdb)
        with respx.mock:
            s = respx.get(SKIPDB).mock(return_value=httpx.Response(200, json=skipdb_body(seg(5000, 95000), seg(0, 4000), seg(2400000, 2500000))))
            await client.get("/api/segments", params={"media_type": "movie", "tmdb_id": 603, "season_number": 3, "episode_number": 4})
        assert "season" not in dict(s.calls[0].request.url.params)

    async def test_no_imdb_id_or_tmdb_trouble_means_no_segments_not_an_error(self, client, login, monkeypatch):
        async def none(tmdb_id):
            return None

        async def boom(tmdb_id):
            raise tmdb_service.TMDBError(502, "down")

        monkeypatch.setattr(tmdb_service, "get_movie_imdb_id", none)
        r = await client.get("/api/segments", params={"media_type": "movie", "tmdb_id": 603})
        assert r.status_code == 200 and r.json() == {"intro": None, "recap": None, "credits": None}
        monkeypatch.setattr(tmdb_service, "get_movie_imdb_id", boom)
        r = await client.get("/api/segments", params={"media_type": "movie", "tmdb_id": 603})
        assert r.status_code == 200 and r.json()["intro"] is None
