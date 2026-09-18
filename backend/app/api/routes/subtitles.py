"""
Online subtitle discovery routes (Phase 5b).

Auth-protected like the rest of playback — not because results are
per-user, but because they proxy a quota-metered third-party API and
there's no reason to expose that to an unauthenticated caller.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.playback import SubtitleTrackOut
from app.schemas.subtitles import OnlineSubtitleDownloadRequest, OnlineSubtitleResult
from app.services import opensubtitles_service, tmdb_service
from app.services.opensubtitles_service import OpenSubtitlesError
from app.services.tmdb_service import TMDBError

router = APIRouter(tags=["subtitles"])


@router.get("/subtitles/search", response_model=list[OnlineSubtitleResult])
async def search_online_subtitles(
    media_type: str,
    tmdb_id: int,
    season_number: int | None = None,
    episode_number: int | None = None,
    language: str | None = None,
    query: str | None = None,
    current_user: User = Depends(get_current_user),
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'.")

    try:
        imdb_id = (
            await tmdb_service.get_movie_imdb_id(tmdb_id)
            if media_type == "movie"
            else await tmdb_service.get_tv_imdb_id(tmdb_id)
        )
    except TMDBError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    if not imdb_id:
        raise HTTPException(
            status_code=404,
            detail="This title has no IMDb id on TMDB — can't search OpenSubtitles for it.",
        )

    try:
        return await opensubtitles_service.search(imdb_id, season_number, episode_number, language, query)
    except OpenSubtitlesError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/subtitles/download", response_model=SubtitleTrackOut)
async def download_online_subtitle(
    payload: OnlineSubtitleDownloadRequest,
    current_user: User = Depends(get_current_user),
):
    cache_key = opensubtitles_service.build_cache_key(
        payload.media_type,
        payload.tmdb_id,
        payload.season_number,
        payload.episode_number,
        payload.language,
        payload.file_id,
    )

    try:
        path = await opensubtitles_service.download(payload.file_id, cache_key)
    except OpenSubtitlesError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    return SubtitleTrackOut(
        language=payload.language,
        label=payload.label,
        url=f"/subtitle-cache/{path.name}",
        format="srt",
    )
