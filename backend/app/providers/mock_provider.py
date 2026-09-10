"""
Mock playback provider.

Scans the local mock-videos/ and mock-subtitles/ folders (see their
README files) for real test files, rather than returning a fake URL.
This lets the player, subtitle rendering, and customization UI all be
exercised end-to-end against genuine video/subtitle content, without
needing any real licensed source or the future Candy Server.

Future providers (legit external links, self-hosted Candy Server) will
live alongside this one and share the same PlaybackSource shape — the
player never needs to know which provider produced a source.
"""
from pathlib import Path

from app.core.config import get_settings
from app.schemas.playback import SubtitleTrackOut

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt"}

_LANGUAGE_LABELS = {
    "en": "English",
    "fa": "Persian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ar": "Arabic",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "und": "Unknown",
}


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


def _find_mock_subtitles() -> list[SubtitleTrackOut]:
    subs_dir = Path(get_settings().mock_subtitles_dir)
    if not subs_dir.exists():
        return []

    tracks = []
    for entry in sorted(subs_dir.iterdir()):
        if not entry.is_file() or entry.suffix.lower() not in SUBTITLE_EXTENSIONS:
            continue

        # Naming convention: <name>.<language-code>.<ext>, e.g. movie.en.srt
        stem_parts = entry.stem.split(".")
        lang = stem_parts[-1].lower() if len(stem_parts) > 1 else "und"
        label = _LANGUAGE_LABELS.get(lang, lang.upper())
        fmt = "srt" if entry.suffix.lower() == ".srt" else "vtt"

        tracks.append(
            SubtitleTrackOut(
                language=lang,
                label=label,
                url=f"/mock-subtitles/{entry.name}",
                format=fmt,
            )
        )
    return tracks


def get_mock_playback() -> tuple[str, list[SubtitleTrackOut]]:
    """Returns (video_url, subtitle_tracks). Raises MockVideoNotConfigured
    with a clear, actionable message if no video file has been placed
    in mock-videos/ yet — this is expected during initial dev setup,
    not a real error."""
    video = _find_mock_video()
    if video is None:
        settings = get_settings()
        raise MockVideoNotConfigured(
            f"No mock video found in '{settings.mock_videos_dir}/'. "
            f"Add a video file ({', '.join(sorted(VIDEO_EXTENSIONS))}) there to test playback."
        )
    return f"/mock-videos/{video.name}", _find_mock_subtitles()
