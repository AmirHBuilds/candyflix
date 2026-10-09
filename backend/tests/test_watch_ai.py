"""
Phase 16 — the watch assistant. Real app, Postgres and Redis; Gemini is mocked with respx and TMDB /
subtitles are stubbed, so nothing here needs a key or a network.
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
from app.models.site_setting import SiteSetting
from app.schemas.media import Episode, MovieDetail, SeasonDetail, TVShowDetail
from app.services import auth_service, tmdb_service, watch_ai_service

pytestmark = pytest.mark.asyncio
settings = get_settings()
GEMINI = f"{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent"
FALLBACK = f"{settings.gemini_base_url}/models/{settings.gemini_fallback_model}:generateContent"

SRT = """1
00:00:01,000 --> 00:00:03,000
<i>Where were you last night?</i>

2
00:00:04,500 --> 00:00:06,000
{\\an8}Out. [door slams]

3
00:00:04,500 --> 00:00:06,000
Out. [door slams]

4
01:02:03,400 --> 01:02:05,000
She was never here. ♪
"""
LINES = [(1.0, "Where were you last night?"), (4.5, "Out. [door slams]"), (3723.4, "She was never here.")]


def reply(text="It seems **Anna** came home late. ||She leaves for good later.||"):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.fixture(autouse=True)
async def clean_redis():
    redis_module._redis_client = None
    redis = redis_module.get_redis()
    for pattern in ("ai:*", "watchai:*", "tmdb:*"):
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
async def reset_ai_config():
    yield
    async with AsyncSessionLocal() as db:
        row = await db.get(SiteSetting, "ai_config")
        if row:
            await db.delete(row)
            await db.commit()


@pytest.fixture(autouse=True)
def stubs(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    seen = {"dialogue": LINES}

    async def dialogue_for(media_type, tmdb_id, season, episode):
        return seen["dialogue"]

    async def get_tv(i):
        return TVShowDetail(tmdb_id=i, title="Night Owls", overview="A family keeps secrets.", year="2021", genres=["Drama"], seasons=[])

    async def get_movie(i):
        return MovieDetail(tmdb_id=i, title="Her", overview="A man falls for an AI.", year="2013", genres=["Romance"], runtime_minutes=126)

    async def get_season(tv_id, n):
        eps = [Episode(episode_number=k, name=f"Ep {k}", overview=f"Things happen in {k}.") for k in (1, 2, 3)]
        return SeasonDetail(tv_id=tv_id, season_number=n, name="Season 1", episodes=eps)

    async def get_cast(media_type, tmdb_id, limit=12):
        return [("Jo Park", "Anna")]

    monkeypatch.setattr(watch_ai_service, "dialogue_for", dialogue_for)
    monkeypatch.setattr(tmdb_service, "get_tv", get_tv)
    monkeypatch.setattr(tmdb_service, "get_movie", get_movie)
    monkeypatch.setattr(tmdb_service, "get_season", get_season)
    monkeypatch.setattr(tmdb_service, "get_cast", get_cast)
    return seen


async def _client(is_admin=False, **fields):
    username = f"wa_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, username, "Watcher", "testpass123", is_admin=is_admin)
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


def ask_body(**over):
    body = {"media_type": "tv", "tmdb_id": 99, "season_number": 1, "episode_number": 2, "question": "Who is Anna?", "position_seconds": 754}
    body.update(over)
    return body


class TestReadingSubtitles:
    def test_parse_srt_strips_markup_sound_symbols_and_repeats(self):
        assert watch_ai_service.parse_srt(SRT) == [
            (1.0, "Where were you last night?"),
            (4.5, "Out. [door slams]"),
            (3723.4, "She was never here."),
        ]

    def test_parse_srt_survives_garbage(self):
        assert watch_ai_service.parse_srt("") == []
        assert watch_ai_service.parse_srt("not a subtitle file\n\nat all") == []

    def test_clock(self):
        assert [watch_ai_service.clock(s) for s in (0, 65, 754, 3723)] == ["0:00", "1:05", "12:34", "1:02:03"]

    def test_the_transcript_marks_where_the_viewer_is(self):
        text = watch_ai_service.build_transcript(LINES, 30)
        rows = text.split("\n")
        assert rows[2] == ">>> THE VIEWER IS HERE: 0:30 <<<"
        assert rows[3].startswith("[1:02:03]")
        assert "after the last line" in watch_ai_service.build_transcript(LINES, 99999).split("\n")[-1]

    def test_a_long_script_is_thinned_but_stays_whole_near_the_viewer(self):
        long = [(float(i), f"line number {i} " + "x" * 40) for i in range(0, 3000)]
        text = watch_ai_service.build_transcript(long, 1500, max_chars=40_000)
        assert len(text) < 60_000
        assert all(f"[{watch_ai_service.clock(i)}] line number {i} " in text for i in range(1400, 1600))


class TestAsking:
    @respx.mock
    async def test_the_prompt_carries_the_dialogue_the_position_and_the_descriptions(self, person):
        route = respx.post(GEMINI).mock(return_value=reply())
        r = await person.post("/api/ai/watch/ask", json=ask_body())
        assert r.status_code == 200
        body = r.json()
        assert body["answer"].startswith("It seems") and "||" in body["answer"]
        assert body["has_dialogue"] is True and body["limit"] == 20 and body["remaining"] == 19
        sent = json.loads(route.calls[0].request.content)
        system = sent["systemInstruction"]["parts"][0]["text"]
        assert "||" in system  # the spoiler rule
        assert "Night Owls" in system and "S1E2" in system and "Jo Park as Anna" in system
        assert "EARLIER EPISODES THIS SEASON" in system and "S1E1" in system and "S1E3" not in system
        assert ">>> THE VIEWER IS HERE: 12:34 <<<" in system and "Out. [door slams]" in system
        assert sent["contents"][-1]["parts"][0]["text"].startswith("[viewer at 12:34] Who is Anna?")

    @respx.mock
    async def test_quick_actions_add_an_instruction_and_the_conversation_is_passed_on(self, person):
        route = respx.post(GEMINI).mock(return_value=reply("Recap…"))
        history = [
            {"role": "assistant", "text": "stale opener"},  # a model turn can't come first
            {"role": "user", "text": "Hi", "position_seconds": 60},
            {"role": "assistant", "text": "Hello"},
        ]
        r = await person.post("/api/ai/watch/ask", json=ask_body(question="Recap of the whole episode", intent="recap_all", history=history))
        assert r.status_code == 200
        roles = [c["role"] for c in json.loads(route.calls[0].request.content)["contents"]]
        assert roles == ["user", "model", "user"]
        last = json.loads(route.calls[0].request.content)["contents"][-1]["parts"][0]["text"]
        assert "whole episode" in last and "do NOT need spoiler bars" in last
        assert json.loads(route.calls[0].request.content)["contents"][0]["parts"][0]["text"] == "[viewer at 1:00] Hi"

    @respx.mock
    async def test_without_a_subtitle_it_still_answers_from_the_descriptions(self, person, stubs):
        stubs["dialogue"] = []
        route = respx.post(GEMINI).mock(return_value=reply("From the description…"))
        r = await person.post("/api/ai/watch/ask", json=ask_body(media_type="movie", season_number=None, episode_number=None, question="What's the setup?"))
        assert r.status_code == 200 and r.json()["has_dialogue"] is False
        system = json.loads(route.calls[0].request.content)["systemInstruction"]["parts"][0]["text"]
        assert "DIALOGUE: not available" in system and "the movie Her (2013)" in system

    @respx.mock
    async def test_a_busy_model_falls_back_to_the_lighter_one(self, person):
        respx.post(GEMINI).mock(return_value=httpx.Response(429))
        respx.post(FALLBACK).mock(return_value=reply("Lighter answer"))
        r = await person.post("/api/ai/watch/ask", json=ask_body())
        assert r.status_code == 200 and r.json()["answer"] == "Lighter answer"

    async def test_bad_requests_are_refused(self, person):
        assert (await person.post("/api/ai/watch/ask", json=ask_body(question=""))).status_code == 422
        assert (await person.post("/api/ai/watch/ask", json=ask_body(question="x" * 401))).status_code == 422
        assert (await person.post("/api/ai/watch/ask", json=ask_body(media_type="book"))).status_code == 422
        assert (await person.post("/api/ai/watch/ask", json=ask_body(position_seconds=-5))).status_code == 422
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
            assert (await anon.post("/api/ai/watch/ask", json=ask_body())).status_code in (401, 403)


class TestAllowance:
    async def test_status_is_separate_from_ai_search(self, person, admin):
        body = (await person.get("/api/ai/watch/status")).json()
        assert body == {"enabled": True, "limit": 20, "used": 0, "remaining": 20}
        assert (await person.get("/api/ai/status")).json()["limit"] == 5
        assert (await admin.get("/api/ai/watch/status")).json()["limit"] is None

    @respx.mock
    async def test_it_does_not_use_up_ai_searches_and_failures_are_refunded(self, person):
        respx.post(GEMINI).mock(return_value=reply())
        await person.post("/api/ai/watch/ask", json=ask_body())
        assert (await person.get("/api/ai/status")).json()["used"] == 0
        assert (await person.get("/api/ai/watch/status")).json()["used"] == 1
        respx.post(GEMINI).mock(return_value=httpx.Response(500))
        respx.post(FALLBACK).mock(return_value=httpx.Response(500))
        r = await person.post("/api/ai/watch/ask", json=ask_body())
        assert r.status_code in (502, 503)
        assert (await person.get("/api/ai/watch/status")).json()["used"] == 1

    @respx.mock
    async def test_the_daily_number_is_enforced_and_an_admin_has_none(self, admin):
        c, name, uid = await _client(watch_ai_daily_limit=2)
        try:
            respx.post(GEMINI).mock(return_value=reply())
            codes = [(await c.post("/api/ai/watch/ask", json=ask_body())).status_code for _ in range(3)]
            assert codes == [200, 200, 429]
            for _ in range(3):
                assert (await admin.post("/api/ai/watch/ask", json=ask_body())).status_code == 200
        finally:
            await _drop(c, name)

    async def test_switched_off_for_one_person_or_for_everyone(self, person, admin):
        c, name, _ = await _client(watch_ai_daily_limit=0)
        try:
            assert (await c.post("/api/ai/watch/ask", json=ask_body())).status_code == 403
        finally:
            await _drop(c, name)
        await admin.put("/api/admin/ai/config", json={"enabled": True, "default_daily_limit": 5, "watch_enabled": False, "watch_daily_limit": 20})
        assert (await person.get("/api/ai/watch/status")).json()["enabled"] is False
        assert (await person.get("/api/ai/status")).json()["enabled"] is True  # search is untouched
        assert (await person.post("/api/ai/watch/ask", json=ask_body())).status_code == 503

    async def test_no_key_means_no_assistant(self, person, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "")
        assert (await person.get("/api/ai/watch/status")).json()["enabled"] is False
        assert (await person.post("/api/ai/watch/ask", json=ask_body())).status_code == 503


class TestAdminControls:
    async def test_site_number_and_a_persons_own_number(self, admin, person):
        r = await admin.put("/api/admin/ai/config", json={"enabled": True, "default_daily_limit": 5, "watch_enabled": True, "watch_daily_limit": 7})
        assert r.status_code == 200 and r.json()["watch_daily_limit"] == 7
        assert (await person.get("/api/ai/watch/status")).json()["limit"] == 7
        url = f"/api/admin/users/{person.uid}"
        assert (await admin.patch(url, json={"watch_ai_daily_limit": 3})).json()["watch_ai_daily_limit"] == 3
        assert (await person.get("/api/ai/watch/status")).json()["limit"] == 3
        assert (await admin.patch(url, json={"display_name": "Renamed"})).json()["watch_ai_daily_limit"] == 3  # untouched
        assert (await admin.patch(url, json={"watch_ai_daily_limit": None})).json()["watch_ai_daily_limit"] is None
        assert (await admin.patch(url, json={"watch_ai_daily_limit": -1})).status_code == 422
        overview = (await admin.get("/api/admin/ai")).json()
        mine = next(u for u in overview["users"] if u["id"] == str(person.uid))
        assert mine["watch_effective_limit"] == 7 and mine["watch_used_today"] == 0
        assert overview["watch_enabled"] is True and overview["watch_asks_today"] == 0


class TestDialogueLookup:
    async def test_reads_the_cached_subtitle_file_once_and_remembers_it(self, tmp_path, monkeypatch):
        from app.services import subtitle_service

        f = tmp_path / "x.srt"
        f.write_bytes(SRT.encode("utf-8"))
        calls = []

        async def path(*a):
            calls.append(a)
            return f

        monkeypatch.undo()  # the autouse stub replaced dialogue_for; use the real one here
        monkeypatch.setattr(subtitle_service, "default_english_path", path)
        first = await watch_ai_service.dialogue_for("tv", 5, 1, 2)
        assert first == LINES
        assert await watch_ai_service.dialogue_for("tv", 5, 1, 2) == LINES
        assert len(calls) == 1  # the second read came from Redis

    async def test_no_subtitle_or_a_failing_lookup_is_just_no_dialogue(self, monkeypatch):
        from app.services import subtitle_service

        monkeypatch.undo()

        async def none(*a):
            return None

        async def boom(*a):
            raise RuntimeError("OpenSubtitles is down")

        monkeypatch.setattr(subtitle_service, "default_english_path", none)
        assert await watch_ai_service.dialogue_for("movie", 6, None, None) == []
        monkeypatch.setattr(subtitle_service, "default_english_path", boom)
        assert await watch_ai_service.dialogue_for("movie", 7, None, None) == []
