"""
Tests for the mock playback provider — uses a real temp directory
(monkeypatched as the configured mock-videos path), not a mocked
filesystem, so folder scanning is genuinely exercised.

Subtitle scanning/parsing tests used to live here too, back when
mock-subtitles/ was the source of subtitles. As of Phase 5b that's
gone — see test_subtitle_service.py for the OpenSubtitles-backed
replacement.
"""
import pytest

from app.providers import mock_provider


@pytest.fixture
def mock_videos_dir(tmp_path, monkeypatch):
    videos = tmp_path / "mock-videos"
    videos.mkdir()
    # Settings is a cached singleton (lru_cache) — patch its instance
    # attribute directly so mock_provider (which calls get_settings()
    # fresh each time) picks up this temp path.
    settings = mock_provider.get_settings()
    monkeypatch.setattr(settings, "mock_videos_dir", str(videos))
    return videos


def test_no_video_raises_clear_error(mock_videos_dir):
    with pytest.raises(mock_provider.MockVideoNotConfigured, match="mock-videos"):
        mock_provider.get_mock_video_url()


def test_finds_video(mock_videos_dir):
    (mock_videos_dir / "test-movie.mp4").write_bytes(b"fake video bytes")

    url = mock_provider.get_mock_video_url()

    assert url == "/mock-videos/test-movie.mp4"


def test_ignores_non_video_files_in_videos_dir(mock_videos_dir):
    (mock_videos_dir / "notes.txt").write_text("not a video")
    (mock_videos_dir / "real.mkv").write_bytes(b"fake")

    url = mock_provider.get_mock_video_url()

    assert url == "/mock-videos/real.mkv"


def test_picks_first_video_alphabetically_when_multiple_exist(mock_videos_dir):
    (mock_videos_dir / "b-movie.mov").write_bytes(b"fake")
    (mock_videos_dir / "a-movie.mp4").write_bytes(b"fake")

    url = mock_provider.get_mock_video_url()

    assert url == "/mock-videos/a-movie.mp4"
