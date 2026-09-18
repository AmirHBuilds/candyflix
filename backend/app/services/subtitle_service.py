"""
Builds the default subtitle track attached to every playback source:
the best (most-downloaded) English result from OpenSubtitles, resolved
and downloaded automatically so it's just there and ready the moment
playback starts — no separate search step needed for the common case.
This replaces what mock-subtitles/ used to provide locally; that folder
and its naming convention are unused as of Phase 5b.

Failure anywhere in this chain — no API key configured, the title has
no IMDb id, no English subtitle exists for it, OpenSubtitles is down —
degrades to "no default subtitle" rather than breaking playback.
Subtitles are a nice-to-have; video starting is not something an
optional enhancement should ever be allowed to block.
"""
import logging

from app.schemas.playback import SubtitleTrackOut
from app.services import opensubtitles_service, tmdb_service
from app.services.opensubtitles_service import OpenSubtitlesError
from app.services.tmdb_service import TMDBError

logger = logging.getLogger("app.subtitle_service")


async def get_default_english_track(
    media_type: str,
    tmdb_id: int,
    season_number: int | None,
    episode_number: int | None,
) -> SubtitleTrackOut | None:
    try:
        imdb_id = (
            await tmdb_service.get_movie_imdb_id(tmdb_id)
            if media_type == "movie"
            else await tmdb_service.get_tv_imdb_id(tmdb_id)
        )
        if not imdb_id:
            logger.info("No IMDb id for %s %s — skipping default subtitle.", media_type, tmdb_id)
            return None

        results = await opensubtitles_service.search(
            imdb_id, season_number, episode_number, language="en"
        )
        if not results:
            logger.info("No English subtitles found for %s %s.", media_type, tmdb_id)
            return None

        best = results[0]  # search() already sorts most-downloaded first
        cache_key = opensubtitles_service.build_cache_key(
            media_type, tmdb_id, season_number, episode_number, "en", best.file_id
        )
        path = await opensubtitles_service.download(best.file_id, cache_key)
        return SubtitleTrackOut(
            language="en", label="English", url=f"/subtitle-cache/{path.name}", format="srt"
        )
    except (TMDBError, OpenSubtitlesError) as e:
        logger.warning(
            "Couldn't fetch a default English subtitle for %s %s: %s", media_type, tmdb_id, e
        )
        return None
    except Exception:
        # Genuinely unexpected (parsing error, etc.) — still must not take
        # playback down with it, but worth a full traceback in the logs.
        logger.exception(
            "Unexpected error fetching default English subtitle for %s %s", media_type, tmdb_id
        )
        return None
