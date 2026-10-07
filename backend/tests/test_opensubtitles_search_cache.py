import httpx
import pytest
import respx

from app.core.config import get_settings
from app.services import opensubtitles_service

pytestmark = [pytest.mark.asyncio, pytest.mark.search_cache]


@respx.mock
async def test_the_same_search_is_answered_from_memory_the_second_time(monkeypatch):
    store: dict = {}

    async def get(key):
        return store.get(key)

    async def put(key, data):
        store[key] = data

    monkeypatch.setattr(opensubtitles_service, "_cache_get", get)
    monkeypatch.setattr(opensubtitles_service, "_cache_set", put)
    monkeypatch.setattr(get_settings(), "opensubtitles_api_key", "k")
    monkeypatch.setattr(opensubtitles_service, "_auth_headers", lambda: _headers())
    route = respx.get(f"{opensubtitles_service.OPENSUBTITLES_BASE}/subtitles").mock(
        return_value=httpx.Response(200, json={"data": [{"attributes": {"language": "en", "release": "A", "download_count": 5, "files": [{"file_id": 1}]}}]})
    )
    first = await opensubtitles_service.search("tt0903747", 1, 1, language="en")
    second = await opensubtitles_service.search("tt0903747", 1, 1, language="en")
    assert [r.file_id for r in first.results] == [r.file_id for r in second.results] == [1]
    assert route.call_count == 1


async def _headers():
    return {"Api-Key": "k"}
