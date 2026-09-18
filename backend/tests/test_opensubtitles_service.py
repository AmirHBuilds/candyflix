"""
Tests for opensubtitles_service.

OpenSubtitles itself is mocked via respx (this sandbox can't reach the
real internet), using response shapes that match the documented REST
API v1. The download cache is exercised against a real temp directory
so the "don't re-spend quota on a repeat download" behavior is
genuinely verified, not assumed.
"""
import httpx
import pytest
import respx

from app.core.config import get_settings
from app.services import opensubtitles_service
from app.services.opensubtitles_service import OpenSubtitlesError

pytestmark = pytest.mark.asyncio

settings = get_settings()

SEARCH_RESPONSE = {
    "data": [
        {
            "attributes": {
                "language": "en",
                "release": "Breaking.Bad.S01E01.WEBRip",
                "download_count": 15000,
                "ratings": 9.2,
                "hearing_impaired": False,
                "files": [{"file_id": 111}],
            }
        },
        {
            "attributes": {
                "language": "en",
                "release": "Breaking.Bad.S01E01.HDTV",
                "download_count": 500,
                "ratings": 7.0,
                "hearing_impaired": True,
                "files": [{"file_id": 222}],
            }
        },
        {
            # No files at all — some real OpenSubtitles entries are like
            # this; must be skipped rather than crashing.
            "attributes": {
                "language": "fr",
                "download_count": 10,
                "files": [],
            }
        },
    ]
}


@pytest.fixture(autouse=True)
def require_api_key(monkeypatch):
    monkeypatch.setattr(settings, "opensubtitles_api_key", "test-os-key")
    monkeypatch.setattr(settings, "opensubtitles_username", "")
    monkeypatch.setattr(settings, "opensubtitles_password", "")


class TestSearch:
    @respx.mock
    async def test_search_parses_and_sorts_by_downloads(self):
        route = respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(200, json=SEARCH_RESPONSE)
        )

        results = await opensubtitles_service.search("tt0903747", season_number=1, episode_number=1)

        assert route.called
        sent_params = route.calls[0].request.url.params
        assert sent_params["imdb_id"] == "903747"  # "tt" stripped, leading zero dropped
        assert sent_params["season_number"] == "1"
        assert sent_params["episode_number"] == "1"

        # No-files entry skipped; remaining two sorted most-downloaded first.
        assert [r.file_id for r in results] == [111, 222]
        assert results[0].label == "English"
        assert results[1].hearing_impaired is True

    @respx.mock
    async def test_follows_redirects(self):
        """Regression test for a real bug: OpenSubtitles was observed
        301-redirecting some /subtitles requests. httpx does NOT follow
        redirects by default, so without follow_redirects=True on the
        client, the 301's own HTML body gets treated as the response and
        fails — this must not regress."""
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(
                301, headers={"Location": "https://api.opensubtitles.com/api/v1/subtitles/"}
            )
        )
        respx.get("https://api.opensubtitles.com/api/v1/subtitles/").mock(
            return_value=httpx.Response(200, json=SEARCH_RESPONSE)
        )

        results = await opensubtitles_service.search("tt0903747")

        assert [r.file_id for r in results] == [111, 222]

    async def test_search_without_api_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "opensubtitles_api_key", "")
        with pytest.raises(OpenSubtitlesError) as exc_info:
            await opensubtitles_service.search("tt0903747")
        assert exc_info.value.status_code == 500

    @respx.mock
    async def test_search_rejects_bad_api_key(self):
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(401, json={"message": "invalid key"})
        )
        with pytest.raises(OpenSubtitlesError) as exc_info:
            await opensubtitles_service.search("tt0903747")
        assert exc_info.value.status_code == 401


class TestDownload:
    @respx.mock
    async def test_download_caches_and_skips_second_network_call(self, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "subtitle_cache_dir", str(tmp_path))
        download_route = respx.post("https://api.opensubtitles.com/api/v1/download").mock(
            return_value=httpx.Response(200, json={"link": "https://dl.example.com/sub.srt"})
        )
        file_route = respx.get("https://dl.example.com/sub.srt").mock(
            return_value=httpx.Response(200, text="1\n00:00:01,000 --> 00:00:02,000\nHi\n")
        )

        path = await opensubtitles_service.download(111, "tv-1396-s1e1-en-111")
        assert path.exists()
        assert path.read_text().startswith("1\n")
        assert download_route.call_count == 1
        assert file_route.call_count == 1

        # Second call for the same cache_key must not touch the network
        # again — this is the whole point of caching downloads.
        path_again = await opensubtitles_service.download(111, "tv-1396-s1e1-en-111")
        assert path_again == path
        assert download_route.call_count == 1
        assert file_route.call_count == 1

    @respx.mock
    async def test_download_quota_exhausted_raises_429(self, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "subtitle_cache_dir", str(tmp_path))
        respx.post("https://api.opensubtitles.com/api/v1/download").mock(
            return_value=httpx.Response(406, json={"message": "quota exceeded"})
        )
        with pytest.raises(OpenSubtitlesError) as exc_info:
            await opensubtitles_service.download(999, "movie-1-en-999")
        assert exc_info.value.status_code == 429
