"""
Tests for subtitle_service.get_default_english_track — the function
that replaced mock-subtitles/ as of Phase 5b. Real chain (TMDB ->
OpenSubtitles search -> OpenSubtitles download), both mocked via respx.

The overriding concern here isn't just "does it work" but "does it
degrade to None, not an exception, for every way it can fail" — this
runs on every single playback load, so it must never be able to take
video playback down with it.
"""
import httpx
import pytest
import respx

from app.core.config import get_settings
from app.services import subtitle_service

pytestmark = pytest.mark.asyncio

settings = get_settings()

MOVIE_WITH_IMDB = {"id": 550, "imdb_id": "tt0137523", "title": "Fight Club"}

SEARCH_RESPONSE = {
    "data": [
        {
            "attributes": {
                "language": "en",
                "release": "Fight.Club.1999.BluRay",
                "download_count": 50000,
                "files": [{"file_id": 777}],
            }
        }
    ]
}


@pytest.fixture(autouse=True)
def require_api_key(monkeypatch):
    monkeypatch.setattr(settings, "opensubtitles_api_key", "test-os-key")
    monkeypatch.setattr(settings, "opensubtitles_username", "")
    monkeypatch.setattr(settings, "opensubtitles_password", "")


class TestHappyPath:
    @respx.mock
    async def test_resolves_downloads_and_returns_track(self, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "subtitle_cache_dir", str(tmp_path))
        respx.get("https://api.themoviedb.org/3/movie/550").mock(
            return_value=httpx.Response(200, json=MOVIE_WITH_IMDB)
        )
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(200, json=SEARCH_RESPONSE)
        )
        respx.post("https://api.opensubtitles.com/api/v1/download").mock(
            return_value=httpx.Response(200, json={"link": "https://dl.example.com/fc.srt"})
        )
        respx.get("https://dl.example.com/fc.srt").mock(
            return_value=httpx.Response(200, text="1\n00:00:01,000 --> 00:00:02,000\nHi\n")
        )

        track = await subtitle_service.get_default_english_track("movie", 550, None, None)

        assert track is not None
        assert track.language == "en"
        assert track.label == "English"
        assert track.format == "srt"
        assert track.url == "/subtitle-cache/movie-550-en-777.srt"


class TestGracefulDegradation:
    @respx.mock
    async def test_no_imdb_id_returns_none(self):
        respx.get("https://api.themoviedb.org/3/movie/550").mock(
            return_value=httpx.Response(200, json={"id": 550, "title": "No IMDb link"})
        )
        assert await subtitle_service.get_default_english_track("movie", 550, None, None) is None

    @respx.mock
    async def test_no_english_results_returns_none(self):
        respx.get("https://api.themoviedb.org/3/movie/550").mock(
            return_value=httpx.Response(200, json=MOVIE_WITH_IMDB)
        )
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(200, json={"data": []})
        )
        assert await subtitle_service.get_default_english_track("movie", 550, None, None) is None

    @respx.mock
    async def test_opensubtitles_error_returns_none(self):
        respx.get("https://api.themoviedb.org/3/movie/550").mock(
            return_value=httpx.Response(200, json=MOVIE_WITH_IMDB)
        )
        respx.get("https://api.opensubtitles.com/api/v1/subtitles").mock(
            return_value=httpx.Response(401, json={"message": "invalid key"})
        )
        assert await subtitle_service.get_default_english_track("movie", 550, None, None) is None

    @respx.mock
    async def test_tmdb_down_returns_none(self):
        respx.get("https://api.themoviedb.org/3/movie/550").mock(
            return_value=httpx.Response(500, json={"status_message": "down"})
        )
        assert await subtitle_service.get_default_english_track("movie", 550, None, None) is None

    async def test_missing_api_key_returns_none(self, monkeypatch):
        monkeypatch.setattr(settings, "opensubtitles_api_key", "")
        with respx.mock:
            respx.get("https://api.themoviedb.org/3/movie/550").mock(
                return_value=httpx.Response(200, json=MOVIE_WITH_IMDB)
            )
            assert await subtitle_service.get_default_english_track("movie", 550, None, None) is None
