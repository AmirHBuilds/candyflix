import asyncio
import json

import httpx
import pytest
import respx

from app.core.config import get_settings
from app.services import ai_service, telegram_service as tg

URL = "https://api.telegram.org/botT0KEN/sendMessage"


@pytest.fixture
def configured(monkeypatch):
    s = get_settings()
    for k, v in {"telegram_bot_token": "T0KEN", "telegram_chat_id": "-1001", "telegram_topic_sign_ins": "11", "telegram_topic_ai": "22", "telegram_topic_security": "33"}.items():
        monkeypatch.setattr(s, k, v)
    tg._recent.clear()


async def _drain():
    loop = asyncio.get_running_loop()
    mine = [t for t in list(tg._tasks) if t.get_loop() is loop]
    await asyncio.gather(*mine, return_exceptions=True)


@pytest.mark.asyncio
async def test_nothing_is_sent_without_a_token():
    with respx.mock(assert_all_called=False) as m:
        route = m.post(url__regex=r".*telegram.*").mock(return_value=httpx.Response(200))
        tg.report_sign_in("Candy", "Chrome on Windows")
        await _drain()
        assert not route.called


@pytest.mark.asyncio
async def test_a_report_goes_to_its_topic_and_is_escaped(configured):
    with respx.mock as m:
        route = m.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))
        tg.report_sign_in("<b>Candy</b>", "Chrome")
        await _drain()
    body = json.loads(route.calls[0].request.content)
    assert body["chat_id"] == "-1001" and body["message_thread_id"] == 11 and body["parse_mode"] == "HTML"
    assert "&lt;b&gt;Candy&lt;/b&gt;" in body["text"]


@pytest.mark.asyncio
async def test_a_topic_without_an_id_posts_to_the_main_chat(configured):
    with respx.mock as m:
        route = m.post(URL).mock(return_value=httpx.Response(200))
        tg.report_started()  # no system topic configured
        await _drain()
    assert "message_thread_id" not in json.loads(route.calls[0].request.content)


@pytest.mark.asyncio
async def test_telegram_failing_never_raises(configured):
    with respx.mock as m:
        m.post(URL).mock(side_effect=httpx.ConnectError("down"))
        tg.report_started()
        await _drain()
        m.post(URL).mock(return_value=httpx.Response(500))
        assert await tg.send("system", "x") is False


@pytest.mark.asyncio
async def test_repeats_within_a_minute_are_sent_once(configured):
    with respx.mock as m:
        route = m.post(URL).mock(return_value=httpx.Response(200))
        for _ in range(3):
            tg.report_failed_sign_in("candy", "1.2.3.4", "wrong name or password")
        await _drain()
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_a_paused_model_is_reported_once(configured):
    with respx.mock as m:
        route = m.post(URL).mock(return_value=httpx.Response(200))
        await ai_service.pause_model("gemini-x", 3600)
        await ai_service.pause_model("gemini-x", 3600)
        await _drain()
        await ai_service.clear_pauses()
    assert route.call_count == 1
    assert "gemini-x" in json.loads(route.calls[0].request.content)["text"]


def test_admin_actions_are_routed_and_looking_is_not_reported(configured, monkeypatch):
    sent = []
    monkeypatch.setattr(tg, "notify", lambda topic, text, **k: sent.append((topic, text)))
    tg.report_admin_action("Candy", "user.delete", "Bob", None)
    tg.report_admin_action("Candy", "footer.update", None, None)
    assert [t for t, _ in sent] == ["accounts", "admin"]
