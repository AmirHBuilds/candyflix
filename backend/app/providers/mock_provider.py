"""
Mock playback provider.

Scans the local mock-videos/ folder (see its README) for a real test
video file, rather than returning a fake URL. This lets the player be
exercised end-to-end against genuine video content, without needing
any real licensed source or the future Candy Server.

Subtitles no longer come from here (or from mock-subtitles/, which is
unused as of Phase 5b) — every subtitle, including the default one
shown when a person just hits "turn on captions", now comes from a
real OpenSubtitles lookup. See services/subtitle_service.py.

Future providers (legit external links, self-hosted Candy Server) will
live alongside this one and share the same PlaybackSource shape — the
player never needs to know which provider produced a source.
"""
from pathlib import Path

from app.core.config import get_settings

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov"}


class MockVideoNotConfigured(Exception):
    """Raised when no test video file has been placed in mock-videos/."""


def _find_mock_video() -> Path | None:
    videos_dir = Path(get_settings().mock_videos_dir)
    if not videos_dir.exists():
        return None
    for entry in sorted(videos_dir.iterdir()):
        if entry.is_file() and entry.suffix.lower() in VIDEO_EXTENSIONS:
            return entry
    return None


def get_mock_video_url() -> str:
    """Raises MockVideoNotConfigured with a clear, actionable message if
    no video file has been placed in mock-videos/ yet — this is expected
    during initial dev setup, not a real error."""
    video = _find_mock_video()
    if video is None:
        settings = get_settings()
        raise MockVideoNotConfigured(
            f"No mock video found in '{settings.mock_videos_dir}/'. "
            f"Add a video file ({', '.join(sorted(VIDEO_EXTENSIONS))}) there to test playback."
        )
    return f"/mock-videos/{video.name}"
