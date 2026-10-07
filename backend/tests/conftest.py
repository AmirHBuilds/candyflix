import pytest

from app.services import opensubtitles_service


@pytest.fixture(autouse=True)
def _no_search_cache(request, monkeypatch):
    """OpenSubtitles search results are cached in Redis for a few minutes; tests that reuse the same
    query with different mocked answers must not see each other's. test_search_cache opts back in."""
    if request.node.get_closest_marker("search_cache"):
        return

    async def miss(key):
        return None

    async def skip(key, data):
        return None

    monkeypatch.setattr(opensubtitles_service, "_cache_get", miss)
    monkeypatch.setattr(opensubtitles_service, "_cache_set", skip)


def pytest_configure(config):
    config.addinivalue_line("markers", "search_cache: use the real OpenSubtitles search cache")
