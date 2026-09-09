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
            "vote_average": 7.9,
        },
        {
            "id": 1396,
            "media_type": "tv",
            "name": "Breaking Bad",
            "first_air_date": "2008-01-20",
            "poster_path": "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
            "backdrop_path": "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
            "vote_average": 8.9,
        },
        {
            # Trending "all" also returns people — must be filtered out
            "id": 6193,
            "media_type": "person",
            "name": "Leonardo DiCaprio",
        },
    ],
}

POPULAR_MOVIES_RESPONSE = {
    "page": 1,
    "results": [
        {
            "id": 27205,
            "title": "Inception",
            "release_date": "2010-07-15",
            "poster_path": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
            "backdrop_path": "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
            "vote_average": 8.4,
        }
    ],
}

POPULAR_TV_RESPONSE = {
    "page": 1,
    "results": [
        {
            "id": 1396,
            "name": "Breaking Bad",
            "first_air_date": "2008-01-20",
            "poster_path": "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
            "backdrop_path": "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
            "vote_average": 8.9,
        }
    ],
}

SIMILAR_MOVIES_RESPONSE = {
    "page": 1,
    "results": [
        {
            "id": 155,
            "title": "The Dark Knight",
            "release_date": "2008-07-16",
            "poster_path": "/dark.jpg",
            "backdrop_path": None,
            "vote_average": 8.5,
        }
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


def _make_page_results(count: int, start_id: int, media_type: str | None = "movie") -> list[dict]:
    """Builds minimal TMDB-shaped result dicts for pagination tests."""
    results = []
    for i in range(count):
        tmdb_id = start_id + i
        entry = {
            "id": tmdb_id,
            "release_date": "2024-01-01",
            "poster_path": f"/p{tmdb_id}.jpg",
            "backdrop_path": None,
            "vote_average": 7.0,
        }
        if media_type is not None:
            entry["media_type"] = media_type
        entry["title"] = f"Title {tmdb_id}"
        results.append(entry)
    return results


@respx.mock
async def test_get_trending_dedupes_item_appearing_on_multiple_pages():
    """
    Each TMDB page is cached independently with its own TTL, so two pages
    fetched at different real times can occasionally represent slightly
    different rankings and overlap — the same title showing up on both.
    Without dedup this produces duplicate React keys on the frontend and
    a wasted/duplicated slot in the section. The loop should also keep
    fetching further pages to make up for the item it dropped, so the
    section still reaches its target count.
    """

    def responder(request):
        page = request.url.params.get("page", "1")
        if page == "1":
            # 20 results, but the last one (id=20) will reappear on page 2.
            body = {
                "page": 1,
                "total_pages": 3,
                "results": _make_page_results(20, start_id=1),
            }
        elif page == "2":
            # id=20 duplicated from page 1, plus 19 new ones.
            duplicate = _make_page_results(1, start_id=20)
            fresh = _make_page_results(19, start_id=21)
            body = {"page": 2, "total_pages": 3, "results": duplicate + fresh}
        else:
            body = {"page": 3, "total_pages": 3, "results": _make_page_results(20, start_id=40)}
        return httpx.Response(200, json=body)

    respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(side_effect=responder)

    items = await tmdb_service.get_trending()

    ids = [i.tmdb_id for i in items]
    assert len(ids) == len(set(ids)), "duplicate tmdb_id made it into the results"
    assert len(items) == 24
    # id=20 appears exactly once, keeping its first (higher-ranked) position.
    assert ids.count(20) == 1


@respx.mock
async def test_get_trending_fetches_second_page_to_reach_target():
    """
    TMDB returns 20 results per page, which doesn't divide evenly into
    a 4- or 6-column grid. get_trending should pull a second page so the
    home page has enough items (24) to fill every row completely.
    """

    def responder(request):
        page = request.url.params.get("page", "1")
        if page == "1":
            body = {
                "page": 1,
                "total_pages": 2,
                "results": _make_page_results(20, start_id=1),
            }
        else:
            body = {
                "page": 2,
                "total_pages": 2,
                "results": _make_page_results(20, start_id=21),
            }
        return httpx.Response(200, json=body)

    route = respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(side_effect=responder)

    items = await tmdb_service.get_trending()

    assert len(items) == 24
    assert route.call_count == 2
    # Keeps TMDB's ranked order — first 20 from page 1, then the first
    # 4 needed from page 2 — not an arbitrary re-sort.
    assert [i.tmdb_id for i in items[:3]] == [1, 2, 3]
    assert items[20].tmdb_id == 21
    assert items[23].tmdb_id == 24


@respx.mock
async def test_get_popular_movies_stops_when_tmdb_has_fewer_than_target():
    """If TMDB genuinely has fewer than 24 results (e.g. a niche
    category), we shouldn't loop forever or error — just return what's
    available."""
    respx.get(f"{settings.tmdb_base_url}/movie/popular").mock(
        return_value=httpx.Response(
            200,
            json={
                "page": 1,
                "total_pages": 1,
                "results": _make_page_results(10, start_id=1, media_type=None),
            },
        )
    )

    items = await tmdb_service.get_popular_movies()

    assert len(items) == 10


@respx.mock
async def test_get_trending_second_page_is_cached_independently():
    def responder(request):
        page = request.url.params.get("page", "1")
        if page == "1":
            body = {"page": 1, "total_pages": 2, "results": _make_page_results(20, start_id=1)}
        else:
            body = {"page": 2, "total_pages": 2, "results": _make_page_results(20, start_id=21)}
        return httpx.Response(200, json=body)

    route = respx.get(f"{settings.tmdb_base_url}/trending/all/day").mock(side_effect=responder)

    await tmdb_service.get_trending()
    await tmdb_service.get_trending()

    # Both pages cached — second full call hits TMDB zero times.
    assert route.call_count == 2


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
    assert movie.rating == 7.9

    show = next(i for i in items if i.media_type == "tv")
    assert show.tmdb_id == 1396
    assert show.title == "Breaking Bad"
    assert show.year == "2008"
    assert show.rating == 8.9


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


@respx.mock
async def test_get_trending_week_window_hits_correct_path():
    route = respx.get(f"{settings.tmdb_base_url}/trending/all/week").mock(
        return_value=httpx.Response(200, json=TRENDING_RESPONSE)
    )

    items = await tmdb_service.get_trending(window="week")

    assert route.called
    assert len(items) == 2


@respx.mock
async def test_get_popular_movies_normalizes_without_media_type_field():
    # /movie/popular results don't include a "media_type" key — the
    # type is implied by which endpoint you called.
    respx.get(f"{settings.tmdb_base_url}/movie/popular").mock(
        return_value=httpx.Response(200, json=POPULAR_MOVIES_RESPONSE)
    )

    items = await tmdb_service.get_popular_movies()

    assert len(items) == 1
    assert items[0].media_type == "movie"
    assert items[0].title == "Inception"
    assert items[0].rating == 8.4


@respx.mock
async def test_get_popular_tv_normalizes_without_media_type_field():
    respx.get(f"{settings.tmdb_base_url}/tv/popular").mock(
        return_value=httpx.Response(200, json=POPULAR_TV_RESPONSE)
    )

    items = await tmdb_service.get_popular_tv()

    assert len(items) == 1
    assert items[0].media_type == "tv"
    assert items[0].title == "Breaking Bad"


@respx.mock
async def test_get_similar_movies_fetches_second_page_to_reach_target():
    """'You May Also Like' had the same single-page limitation as the
    home page sections — same fix applies here, just against the
    smaller 12-item target."""

    def responder(request):
        page = request.url.params.get("page", "1")
        if page == "1":
            body = {"page": 1, "total_pages": 2, "results": _make_page_results(8, start_id=1, media_type=None)}
        else:
            body = {"page": 2, "total_pages": 2, "results": _make_page_results(20, start_id=9, media_type=None)}
        return httpx.Response(200, json=body)

    respx.get(f"{settings.tmdb_base_url}/movie/27205/similar").mock(side_effect=responder)

    items = await tmdb_service.get_similar_movies(27205)

    assert len(items) == 12
    assert all(i.media_type == "movie" for i in items)


@respx.mock
@respx.mock
async def test_get_similar_movies_targets_12_not_24():
    """User explicitly asked for a smaller, simpler target here — no
    need to fill a full multi-row grid for 'You May Also Like'."""
    respx.get(f"{settings.tmdb_base_url}/movie/27205/similar").mock(
        return_value=httpx.Response(
            200,
            json={"page": 1, "total_pages": 1, "results": _make_page_results(20, start_id=1, media_type=None)},
        )
    )

    items = await tmdb_service.get_similar_movies(27205)

    assert len(items) == 12


@respx.mock
async def test_get_popular_movies_page_returns_single_page_and_has_more_flag():
    """Load More pagination: unlike the home page sections, this
    should NOT try to fill a target count — just pass through
    whatever TMDB's page has, plus whether another page exists."""
    respx.get(f"{settings.tmdb_base_url}/movie/popular").mock(
        return_value=httpx.Response(
            200,
            json={"page": 1, "total_pages": 3, "results": _make_page_results(20, start_id=1, media_type=None)},
        )
    )

    items, has_more = await tmdb_service.get_popular_movies_page(1)

    assert len(items) == 20
    assert has_more is True


@respx.mock
async def test_get_popular_movies_page_has_more_false_on_last_page():
    respx.get(f"{settings.tmdb_base_url}/movie/popular").mock(
        return_value=httpx.Response(
            200,
            json={"page": 3, "total_pages": 3, "results": _make_page_results(5, start_id=1, media_type=None)},
        )
    )

    items, has_more = await tmdb_service.get_popular_movies_page(3)

    assert len(items) == 5
    assert has_more is False


@respx.mock
async def test_discover_movies_applies_genre_year_and_sort():
    route = respx.get(f"{settings.tmdb_base_url}/discover/movie").mock(
        return_value=httpx.Response(
            200,
            json={"page": 1, "total_pages": 2, "results": _make_page_results(20, start_id=1, media_type=None)},
        )
    )

    items, has_more = await tmdb_service.discover_movies(
        page=1, genre=28, year=2020, sort="rating", min_rating=7
    )

    assert len(items) == 20
    assert has_more is True
    sent_params = dict(route.calls[0].request.url.params)
    assert sent_params["with_genres"] == "28"
    assert sent_params["primary_release_year"] == "2020"
    assert sent_params["sort_by"] == "vote_average.desc"
    assert sent_params["vote_average.gte"] == "7"
    assert "vote_count.gte" in sent_params  # quality floor applied alongside min_rating


@respx.mock
async def test_discover_tv_maps_sort_and_year_field_correctly():
    """TV uses first_air_date_year, not primary_release_year — a
    common copy-paste bug between the two endpoints."""
    route = respx.get(f"{settings.tmdb_base_url}/discover/tv").mock(
        return_value=httpx.Response(
            200,
            json={"page": 1, "total_pages": 1, "results": _make_page_results(3, start_id=1, media_type=None)},
        )
    )

    await tmdb_service.discover_tv(page=1, year=2019, sort="newest")

    sent_params = dict(route.calls[0].request.url.params)
    assert sent_params["first_air_date_year"] == "2019"
    assert sent_params["sort_by"] == "first_air_date.desc"
    assert "primary_release_year" not in sent_params


@respx.mock
async def test_get_similar_movies():
    respx.get(f"{settings.tmdb_base_url}/movie/27205/similar").mock(
        return_value=httpx.Response(200, json=SIMILAR_MOVIES_RESPONSE)
    )

    items = await tmdb_service.get_similar_movies(27205)

    assert len(items) == 1
    assert items[0].tmdb_id == 155
    assert items[0].title == "The Dark Knight"
    assert items[0].media_type == "movie"


@respx.mock
async def test_get_similar_tv_fetches_second_page_to_reach_target():
    def responder(request):
        page = request.url.params.get("page", "1")
        if page == "1":
            body = {"page": 1, "total_pages": 2, "results": _make_page_results(8, start_id=1, media_type=None)}
        else:
            body = {"page": 2, "total_pages": 2, "results": _make_page_results(20, start_id=9, media_type=None)}
        return httpx.Response(200, json=body)

    respx.get(f"{settings.tmdb_base_url}/tv/1399/similar").mock(side_effect=responder)

    items = await tmdb_service.get_similar_tv(1399)

    assert len(items) == 12
    assert all(i.media_type == "tv" for i in items)


async def test_missing_api_key_raises_clear_error(monkeypatch):
    monkeypatch.setattr(tmdb_service.settings, "tmdb_api_key", "")

    with pytest.raises(TMDBError) as exc_info:
        await tmdb_service.get_trending()

    assert exc_info.value.status_code == 500
    assert "not configured" in exc_info.value.message
