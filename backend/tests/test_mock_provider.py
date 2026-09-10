"""
Tests for the mock playback provider — uses real temp directories
(monkeypatched as the configured mock-videos/mock-subtitles paths),
not a mocked filesystem, so folder scanning and filename parsing are
genuinely exercised.
"""
import pytest

from app.providers import mock_provider


@pytest.fixture
def mock_dirs(tmp_path, monkeypatch):
    videos = tmp_path / "mock-videos"
    subs = tmp_path / "mock-subtitles"
    videos.mkdir()
    subs.mkdir()
    # Settings is a cached singleton (lru_cache) — patch its instance
    # attributes directly so mock_provider (which calls get_settings()
    # fresh each time) picks up these temp paths.
    settings = mock_provider.get_settings()
    monkeypatch.setattr(settings, "mock_videos_dir", str(videos))
    monkeypatch.setattr(settings, "mock_subtitles_dir", str(subs))
    return videos, subs


def test_no_video_raises_clear_error(mock_dirs):
    videos, subs = mock_dirs

    with pytest.raises(mock_provider.MockVideoNotConfigured, match="mock-videos"):
        mock_provider.get_mock_playback()


def test_finds_video_with_no_subtitles(mock_dirs):
    videos, subs = mock_dirs
    (videos / "test-movie.mp4").write_bytes(b"fake video bytes")

    url, subtitles = mock_provider.get_mock_playback()

    assert url == "/mock-videos/test-movie.mp4"
    assert subtitles == []


def test_ignores_non_video_files_in_videos_dir(mock_dirs):
    videos, subs = mock_dirs
    (videos / "notes.txt").write_text("not a video")
    (videos / "real.mkv").write_bytes(b"fake")

    url, _ = mock_provider.get_mock_playback()

    assert url == "/mock-videos/real.mkv"


def test_parses_language_from_subtitle_filename(mock_dirs):
    videos, subs = mock_dirs
    (videos / "movie.mp4").write_bytes(b"x")
    (subs / "movie.en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n")
    (subs / "movie.fa.vtt").write_text("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nSalam\n")

    _, subtitles = mock_provider.get_mock_playback()

    by_lang = {t.language: t for t in subtitles}
    assert by_lang["en"].label == "English"
    assert by_lang["en"].format == "srt"
    assert by_lang["en"].url == "/mock-subtitles/movie.en.srt"
    assert by_lang["fa"].label == "Persian"
    assert by_lang["fa"].format == "vtt"


def test_unrecognized_language_code_falls_back_to_raw_code_as_label(mock_dirs):
    videos, subs = mock_dirs
    (videos / "movie.mp4").write_bytes(b"x")
    (subs / "movie.xx.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n")

    _, subtitles = mock_provider.get_mock_playback()

    assert subtitles[0].language == "xx"
    assert subtitles[0].label == "XX"


def test_subtitle_with_no_language_code_gets_und(mock_dirs):
    videos, subs = mock_dirs
    (videos / "movie.mp4").write_bytes(b"x")
    (subs / "plainname.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n")

    _, subtitles = mock_provider.get_mock_playback()

    assert subtitles[0].language == "und"


def test_ignores_non_subtitle_files(mock_dirs):
    videos, subs = mock_dirs
    (videos / "movie.mp4").write_bytes(b"x")
    (subs / "readme.md").write_text("not a subtitle")

    _, subtitles = mock_provider.get_mock_playback()

    assert subtitles == []
