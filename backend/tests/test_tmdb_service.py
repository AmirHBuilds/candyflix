"""
Tests for tmdb_service.

TMDB itself is mocked via respx (this sandbox can't reach the real
internet), using response shapes that match TMDB's actual documented
API. Redis caching is exercised against a real local Redis instance,
so the caching behavior itself is genuinely verified, not mocked.
"""
import json

import httpx
import pytest
import respx

import app.core.redis as redis_module
from app.core.config import get_settings
from app.core.redis import get_redis
from app.services import tmdb_service
from app.services.tmdb_service import TMDBError

settings = get_settings()

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def clear_tmdb_cache():
    """
    Ensures each test starts with a clean cache and its own Redis
    connection. The app's `get_redis()` is a module-level singleton —
    great for production (one long-lived event loop), but pytest-asyncio
    gives each test function its own event loop by default, so a
    connection created in one test can't be reused in the next. We
    reset the singleton here so each test gets a fresh client bound to
    its own loop.
    """
    redis_module._redis_client = None
    redis = get_redis()
    keys = await redis.keys("tmdb:*")
    if keys:
        await redis.delete(*keys)
    yield
    await redis.aclose()
    redis_module._redis_client = None


TRENDING_RESPONSE = {
    "page": 1,
    "results": [
        {
            "id": 603692,
            "media_type": "movie",
            "title": "John Wick: Chapter 4",
            "release_date": "2023-03-22",
            "poster_path": "/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg",
            "backdrop_path": "/b9nl2yjvHuICVqRktM6IE9NkOus.jpg",
        },
        {
            "id": 1396,
            "media_type": "tv",
            "name": "Breaking Bad",
            "first_air_date": "2008-01-20",
            "poster_path": "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
            "backdrop_path": "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
        },
        {
            # Trending "all" also returns people — must be filtered out
            "id": 6193,
            "media_type": "person",
            "name": "Leonardo DiCaprio",
        },
    ],
}

SEARCH_RESPONSE = {
    "page": 1,
    "results": [
        {
            "id": 27205,
            "media_type": "movie",
            "title": "Inception",
            "release_date": "2010-07-15",
            "poster_path": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
            "backdrop_path": "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
        }
    ],
}

MOVIE_RESPONSE = {
    "id": 27205,
    "title": "Inception",
    "overview": "A thief who steals corporate secrets through dream-sharing technology.",
    "release_date": "2010-07-15",
    "genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}],
    "poster_path": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
    "backdrop_path": "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
    "vote_average": 8.4,
    "runtime": 148,
}

TV_RESPONSE = {
    "id": 1396,
    "name": "Breaking Bad",
    "overview": "A high school chemistry teacher turned methamphetamine producer.",
    "first_air_date": "2008-01-20",
    "genres": [{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}],
    "poster_path": "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
    "backdrop_path": "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
    "vote_average": 8.9,
    "seasons": [
        {"season_number": 0, "name": "Specials", "episode_count": 24, "poster_path": None},
        {"season_number": 1, "name": "Season 1", "episode_count": 7, "poster_path": "/s1.jpg"},
        {"season_number": 2, "name": "Season 2", "episode_count": 13, "poster_path": "/s2.jpg"},
    ],
}

SEASON_RESPONSE = {
    "id": 3572,
    "name": "Season 1",
    "season_number": 1,
    "episodes": [
        {
            "episode_number": 1,
            "name": "Pilot",
            "overview": "Walter White's life changes forever.",
            "still_path": "/e1.jpg",
            "air_date": "2008-01-20",
            "runtime": 58,
        },
        {
            "episode_number": 2,
            "name": "Cat's in the Bag...",
            "overview": "Walt and Jesse attempt to tie up loose ends.",
            "still_path": "/e2.jpg",
            "air_date": "2008-01-27",
            "runtime": 48,
        },
    ],
}


@respx.mock
async def test_get_trending_filters_and_normalizes():
    respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(
        return_value=httpx.Response(200, json=TRENDING_RESPONSE)
    )

    items = await tmdb_service.get_trending()

    # The "person" entry must be filtered out — only movie/tv survive.
    assert len(items) == 2

    movie = next(i for i in items if i.media_type == "movie")
    assert movie.tmdb_id == 603692
    assert movie.title == "John Wick: Chapter 4"
    assert movie.year == "2023"

    show = next(i for i in items if i.media_type == "tv")
    assert show.tmdb_id == 1396
    assert show.title == "Breaking Bad"
    assert show.year == "2008"


@respx.mock
async def test_get_trending_uses_cache_on_second_call():
    route = respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(
        return_value=httpx.Response(200, json=TRENDING_RESPONSE)
    )

    await tmdb_service.get_trending()
    await tmdb_service.get_trending()

    # Second call should be served from Redis, not hit TMDB again.
    assert route.call_count == 1


@respx.mock
async def test_search_normalizes_movie_result():
    respx.get(f"{settings.tmdb_base_url}/search/multi").mock(
        return_value=httpx.Response(200, json=SEARCH_RESPONSE)
    )

    results = await tmdb_service.search("inception")

    assert len(results) == 1
    assert results[0].tmdb_id == 27205
    assert results[0].title == "Inception"
    assert results[0].media_type == "movie"


@respx.mock
async def test_get_movie_details():
    respx.get(f"{settings.tmdb_base_url}/movie/27205").mock(
        return_value=httpx.Response(200, json=MOVIE_RESPONSE)
    )

    movie = await tmdb_service.get_movie(27205)

    assert movie.tmdb_id == 27205
    assert movie.title == "Inception"
    assert movie.year == "2010"
    assert "Action" in movie.genres
    assert "Science Fiction" in movie.genres
    assert movie.rating == 8.4
    assert movie.runtime_minutes == 148


@respx.mock
async def test_get_tv_details_skips_season_zero():
    respx.get(f"{settings.tmdb_base_url}/tv/1396").mock(
        return_value=httpx.Response(200, json=TV_RESPONSE)
    )

    show = await tmdb_service.get_tv(1396)

    assert show.tmdb_id == 1396
    assert show.title == "Breaking Bad"
    # "Specials" (season 0) should be excluded per MVP scope.
    assert [s.season_number for s in show.seasons] == [1, 2]


@respx.mock
async def test_get_season_episodes():
    respx.get(f"{settings.tmdb_base_url}/tv/1396/season/1").mock(
        return_value=httpx.Response(200, json=SEASON_RESPONSE)
    )

    season = await tmdb_service.get_season(1396, 1)

    assert season.tv_id == 1396
    assert season.season_number == 1
    assert len(season.episodes) == 2
    assert season.episodes[0].name == "Pilot"
    assert season.episodes[0].runtime_minutes == 58


@respx.mock
async def test_movie_not_found_raises_tmdb_error_404():
    respx.get(f"{settings.tmdb_base_url}/movie/999999999").mock(
        return_value=httpx.Response(404, json={"status_message": "The resource you requested could not be found."})
    )

    with pytest.raises(TMDBError) as exc_info:
        await tmdb_service.get_movie(999999999)

    assert exc_info.value.status_code == 404


@respx.mock
async def test_upstream_error_raises_502():
    respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(
        return_value=httpx.Response(500, json={"status_message": "Internal error"})
    )

    with pytest.raises(TMDBError) as exc_info:
        await tmdb_service.get_trending()

    assert exc_info.value.status_code == 502


async def test_missing_api_key_raises_clear_error(monkeypatch):
    monkeypatch.setattr(tmdb_service.settings, "tmdb_api_key", "")

    with pytest.raises(TMDBError) as exc_info:
        await tmdb_service.get_trending()

    assert exc_info.value.status_code == 500
    assert "not configured" in exc_info.value.message
