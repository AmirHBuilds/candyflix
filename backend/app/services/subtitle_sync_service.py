"""
Phase 11 — subtitle sync.

A person asks for "Sync subtitle" on the track they're watching. The server
listens to the video's audio (ffsubsync, no AI; see tools/sync_subtitle.py for
how), writes a re-timed copy of the subtitle into the subtitle cache and keeps
it, so the next time that video is opened the synced version is simply there.

Progress lives in Redis, keyed by (video, subtitle), not in the browser: the
page polls GET /subtitle-sync/status, so a refresh (or another device) shows
the same running job. The finished file plus a tiny .json sidecar are the
durable record — Redis state is only for "what is happening right now".

One sync runs at a time (the audio work is CPU-heavy and this is a small home
server); others wait in line and show "Waiting for another sync to finish…".
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

from app.core.config import get_settings
from app.core.redis import get_redis
from app.providers import mock_provider
from app.schemas.playback import SubtitleTrackOut
from app.schemas.subtitle_sync import SyncStatus

logger = logging.getLogger("app.subtitle_sync")

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "sync_subtitle.py"
SYNC_PREFIX = "sync-"
STATE_TTL_SECONDS = 3600
JOB_TIMEOUT_SECONDS = 30 * 60
MAX_ACTIVE_JOBS = 8
_SUBTITLE_URL = re.compile(r"^/subtitle-cache/([A-Za-z0-9._-]+\.srt)$")

_semaphore: asyncio.Semaphore | None = None
_tasks: dict[str, asyncio.Task] = {}


class SyncError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


# ---------------------------------------------------------------- identity


def video_key(media_type: str, tmdb_id: int, season: int | None, episode: int | None) -> str:
    return f"{media_type}:{tmdb_id}:{season or 0}:{episode or 0}"


def _digest(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def _job_id(vkey: str, sub_name: str) -> str:
    return f"{_digest(vkey)}-{_digest(sub_name)}"


def _cache_dir() -> Path:
    return Path(get_settings().subtitle_cache_dir)


def _out_path(job_id: str) -> Path:
    return _cache_dir() / f"{SYNC_PREFIX}{job_id}.srt"


def _sidecar_path(job_id: str) -> Path:
    return _cache_dir() / f"{SYNC_PREFIX}{job_id}.json"


def _redis_key(job_id: str) -> str:
    return f"subsync:{job_id}"


def subtitle_name_from_url(url: str) -> str:
    """'/subtitle-cache/x.srt' -> 'x.srt', only for a file that really is in the cache."""
    m = _SUBTITLE_URL.match(url or "")
    if not m or m.group(1).startswith(SYNC_PREFIX):
        raise SyncError(400, "That subtitle can't be synced.")
    if not (_cache_dir() / m.group(1)).is_file():
        raise SyncError(404, "That subtitle file is no longer available.")
    return m.group(1)


# ---------------------------------------------------------------- results


def _track_for(job_id: str) -> SubtitleTrackOut | None:
    out, side = _out_path(job_id), _sidecar_path(job_id)
    if not (out.is_file() and side.is_file()):
        return None
    try:
        meta = json.loads(side.read_text())
        return SubtitleTrackOut(
            language=meta["language"],
            label=meta["label"],
            url=f"/subtitle-cache/{out.name}",
            format="srt",
            synced=True,
        )
    except Exception:
        logger.warning("Unreadable sync sidecar %s", side)
        return None


def synced_tracks_for_video(vkey: str) -> list[SubtitleTrackOut]:
    """Every synced subtitle kept for this video, for the playback source."""
    prefix = f"{SYNC_PREFIX}{_digest(vkey)}-"
    tracks = []
    for side in sorted(_cache_dir().glob(f"{prefix}*.json")):
        track = _track_for(side.stem[len(SYNC_PREFIX):])
        if track:
            tracks.append(track)
    return tracks


# ---------------------------------------------------------------- state


async def _set_state(job_id: str, state: str, percent: float = 0, stage: str | None = None, message: str | None = None):
    payload = {"state": state, "percent": int(percent), "stage": stage, "message": message, "at": time.time()}
    await get_redis().set(_redis_key(job_id), json.dumps(payload), ex=STATE_TTL_SECONDS)


async def get_status(vkey: str, sub_name: str) -> SyncStatus:
    job_id = _job_id(vkey, sub_name)
    track = _track_for(job_id)
    if track:
        return SyncStatus(state="done", percent=100, stage="done", message="Subtitle synced", track=track)

    raw = await get_redis().get(_redis_key(job_id))
    if not raw:
        return SyncStatus(state="idle")
    data = json.loads(raw)
    state = data["state"]
    if state in ("queued", "running") and job_id not in _tasks:
        # Redis says it's running but nothing in this process is: the server
        # restarted mid-sync. Say so instead of showing a bar that never moves.
        return SyncStatus(state="failed", message="The sync was interrupted. Please try again.")
    return SyncStatus(state=state, percent=data["percent"], stage=data["stage"], message=data["message"])


# ---------------------------------------------------------------- running


async def start(
    vkey: str, sub_name: str, language: str, label: str
) -> SyncStatus:
    job_id = _job_id(vkey, sub_name)
    current = await get_status(vkey, sub_name)
    if current.state in ("done", "queued", "running"):
        return current

    media = mock_provider.get_mock_video_path()
    if media is None:
        raise SyncError(404, "This video isn't available to sync against.")
    if len(_tasks) >= MAX_ACTIVE_JOBS:
        raise SyncError(429, "Lots of syncs are running right now. Try again in a few minutes.")

    await _set_state(job_id, "queued", 0, "queued", "Starting…")
    task = asyncio.create_task(_run(job_id, vkey, media, sub_name, language, label))
    _tasks[job_id] = task
    task.add_done_callback(lambda _t, j=job_id: _tasks.pop(j, None))
    return await get_status(vkey, sub_name)


def _semaphore_instance() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(1)
    return _semaphore


async def _run(job_id: str, vkey: str, media: Path, sub_name: str, language: str, label: str):
    settings = get_settings()
    sub_path = _cache_dir() / sub_name
    sync_dir = Path(settings.sync_cache_dir)
    sync_dir.mkdir(parents=True, exist_ok=True)
    tmp_out = sync_dir / f"tmp-{job_id}.srt"
    try:
        sem = _semaphore_instance()
        if sem.locked():
            await _set_state(job_id, "queued", 0, "queued", "Waiting for another sync to finish…")
        async with sem:
            await _set_state(job_id, "running", 1, "prepare", "Getting started…")
            result = await _run_script(job_id, media, sub_path, tmp_out, sync_dir)
            await _finish(job_id, vkey, sub_name, language, label, tmp_out, result)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Subtitle sync crashed for %s", job_id)
        await _set_state(job_id, "failed", 0, None, "Syncing didn't work out. Please try again.")
    finally:
        for leftover in sync_dir.glob(f"tmp-{job_id}*"):  # the output copy and its .report.json
            leftover.unlink(missing_ok=True)


async def _run_script(job_id: str, media: Path, sub_path: Path, tmp_out: Path, sync_dir: Path) -> dict | None:
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(SCRIPT),
        str(media),
        str(sub_path),
        "-o",
        str(tmp_out),
        "--cache-dir",
        str(sync_dir),
        "--progress-json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    result: dict | None = None
    tail: list[str] = []
    last_written = (-1, None)

    async def pump():
        nonlocal result, last_written
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                tail.append(line)
                del tail[:-20]
                continue
            if "result" in obj:
                result = obj["result"]
            elif "percent" in obj:
                marker = (int(obj["percent"]), obj.get("message"))
                if marker != last_written:
                    last_written = marker
                    await _set_state(job_id, "running", obj["percent"], obj.get("stage"), obj.get("message"))

    try:
        await asyncio.wait_for(asyncio.gather(pump(), proc.wait()), timeout=JOB_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        logger.error("Subtitle sync timed out for %s", job_id)
        return None
    if proc.returncode != 0:
        logger.error("Subtitle sync script failed (%s): %s", proc.returncode, " | ".join(tail))
        return None
    return result


def _already_in_sync(report: dict) -> bool:
    g = report.get("global_pass") or {}
    offset, scale = g.get("offset_seconds"), g.get("framerate_scale")
    return (
        offset is not None
        and abs(offset) < 0.3
        and (scale is None or abs(scale - 1) < 0.0005)
        and not report.get("segments")
    )


async def _finish(job_id, vkey, sub_name, language, label, tmp_out: Path, report: dict | None):
    if report is None:
        await _set_state(job_id, "failed", 0, None, "Syncing didn't work out. Please try again.")
        return
    if not (report.get("improved") and tmp_out.is_file()):
        if _already_in_sync(report):
            await _set_state(job_id, "unchanged", 100, "done", "This subtitle already looks in sync with the video.")
        else:
            await _set_state(
                job_id, "failed", 0, None,
                "Couldn't sync this one confidently, so it was left as it is. It may be for a different cut of the video.",
            )
        return

    os.replace(tmp_out, _out_path(job_id))
    _sidecar_path(job_id).write_text(
        json.dumps(
            {
                "video": vkey,
                "source": sub_name,
                "language": language,
                "label": label,
                "method": report.get("method_used"),
                "quality_before": (report.get("quality") or {}).get("speech_overlap_before"),
                "quality_after": (report.get("quality") or {}).get("speech_overlap_after"),
                "created": int(time.time()),
            }
        )
    )
    await _set_state(job_id, "done", 100, "done", "Subtitle synced")
    logger.info("Synced %s for %s via %s", sub_name, vkey, report.get("method_used"))
