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
from app.main import app

pytestmark = pytest.mark.asyncio


async def test_mock_video_file_is_served_with_real_bytes():
    videos_dir = Path(get_settings().mock_videos_dir)
    test_file = videos_dir / "_static_mount_test.mp4"
    test_file.write_bytes(b"fake mp4 bytes for real")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/mock-videos/_static_mount_test.mp4")

        assert resp.status_code == 200
        assert resp.content == b"fake mp4 bytes for real"
    finally:
        test_file.unlink(missing_ok=True)


async def test_nonexistent_mock_file_returns_404():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
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
        async with AsyncClient(transport=transport, base_url="http://test") as client:
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
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/subtitle-cache/_static_mount_test.srt")

        assert resp.status_code == 200
        assert resp.text == srt_content
    finally:
        test_file.unlink(missing_ok=True)
