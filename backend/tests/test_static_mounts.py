"""
Verifies the /mock-videos and /subtitle-cache StaticFiles mounts
actually serve real file bytes, exercised through the app's real ASGI
interface (same technique as test_playback_routes.py) rather than a
background server process.

NOTE: app.mount(..., StaticFiles(directory=settings.mock_videos_dir))
binds that directory path once, at app construction time (import
time) - monkeypatching settings.mock_videos_dir afterward has no
effect on an already-mounted StaticFiles instance. So these tests
write real files into the actual configured folders (cleaning up
after) rather than trying to redirect the mount elsewhere.

(/mock-subtitles/ was removed in Phase 5b — subtitles now come from
OpenSubtitles, served out of /subtitle-cache instead.)
"""
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.db import AsyncSessionLocal, engine
from app.core.redis import get_redis
import app.core.redis as redis_module
from app.core.security import SESSION_COOKIE_NAME
from app.main import app
from app.services import auth_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def redis_and_pool():
    redis_module._redis_client = None
    redis_module.get_redis()
    yield
    await redis_module.get_redis().aclose()
    redis_module._redis_client = None
    await engine.dispose()


async def signed_in_cookie() -> dict:
    """A session cookie for a throwaway person: videos and subtitles are only served to signed-in people."""
    import uuid

    name = f"st_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, name, name.title(), "password123")
        uid = user.id
    return {SESSION_COOKIE_NAME: await auth_service.create_session(uid)}


async def test_files_are_refused_without_signing_in():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/mock-videos/anything.mp4")).status_code == 401
        assert (await client.get("/subtitle-cache/anything.srt")).status_code == 401
        client.cookies.set(SESSION_COOKIE_NAME, "not-a-real-session")
        assert (await client.get("/mock-videos/anything.mp4")).status_code == 401
        # profile pictures stay open: the sign-in screen shows them
        assert (await client.get("/avatars/none.webp")).status_code == 404


async def test_mock_video_file_is_served_with_real_bytes():
    videos_dir = Path(get_settings().mock_videos_dir)
    test_file = videos_dir / "_static_mount_test.mp4"
    test_file.write_bytes(b"fake mp4 bytes for real")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", cookies=await signed_in_cookie()) as client:
            resp = await client.get("/mock-videos/_static_mount_test.mp4")

        assert resp.status_code == 200
        assert resp.content == b"fake mp4 bytes for real"
    finally:
        test_file.unlink(missing_ok=True)


async def test_nonexistent_mock_file_returns_404():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", cookies=await signed_in_cookie()) as client:
        resp = await client.get("/mock-videos/definitely-does-not-exist.mp4")

    assert resp.status_code == 404


async def test_mock_video_range_response_is_never_browser_cached():
    """Regression test for a real bug: every "episode" resolves to the same
    physical mock video file, so the browser issues many different Range
    requests against one URL in a session. Without an explicit no-store
    Cache-Control header, the browser's own heuristic caching of 206
    responses gets confused by this pattern and can silently replay a
    stale/mismatched cached response (visible in DevTools as "(from disk
    cache)") instead of hitting the network — stalling playback with no
    corresponding request ever reaching the server. Confirmed via a live
    reproduction: DevTools showed a hung request served "(from disk cache)"
    with zero matching backend log line. See NoCacheStaticFiles in main.py.
    """
    videos_dir = Path(get_settings().mock_videos_dir)
    test_file = videos_dir / "_static_mount_cache_test.mp4"
    test_file.write_bytes(b"0123456789" * 5)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", cookies=await signed_in_cookie()) as client:
            resp = await client.get(
                "/mock-videos/_static_mount_cache_test.mp4", headers={"Range": "bytes=0-4"}
            )
        assert resp.status_code == 206
        assert resp.headers.get("cache-control") == "no-store"
    finally:
        test_file.unlink(missing_ok=True)


async def test_subtitle_cache_file_is_served_with_real_bytes():
    cache_dir = Path(get_settings().subtitle_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    test_file = cache_dir / "_static_mount_test.srt"
    srt_content = "1\n00:00:01,000 --> 00:00:04,000\nHello from a real subtitle file\n"
    test_file.write_text(srt_content)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", cookies=await signed_in_cookie()) as client:
            resp = await client.get("/subtitle-cache/_static_mount_test.srt")

        assert resp.status_code == 200
        assert resp.text == srt_content
    finally:
        test_file.unlink(missing_ok=True)
