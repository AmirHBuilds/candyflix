"""
The error log. Anything that fails (an unhandled error, a 5xx answer, an error or warning in the logs, a failed
subtitle sync, a problem reported by a browser) is written to the database and, when it is new, sent to Telegram.

- The same problem repeating within REPEAT_MINUTES is one row with a counter, so a broken page can't flood the table
  or the chat.
- Recording never raises and never slows a request: it runs as a background task and swallows its own failures.
- Nothing private is stored: no passwords, no AI prompts, no watch history.
"""
import asyncio
import hashlib
import logging
import re
import time
import traceback
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update

from app.core.db import AsyncSessionLocal
from app.models.error_log import ErrorLog
from app.services import telegram_service

logger = logging.getLogger(__name__)

REPEAT_MINUTES = 30
KEEP_DAYS = 30
MAX_ROWS = 3000
SOURCES = ("server", "ai", "resolver", "sync", "subtitles", "tmdb", "browser", "system")
ICONS = {"server": "🔥", "ai": "🤖", "resolver": "📡", "sync": "🎞", "subtitles": "💬", "tmdb": "🎬", "browser": "🌐", "system": "🖥"}
# Which Telegram topic each source goes to (see telegram_service.TOPICS).
TOPIC = {"ai": "ai"}

_tasks: set[asyncio.Task] = set()
_sent: list[float] = []  # when the last Telegram messages left, to cap a burst
BURST = (20, 600)  # at most 20 messages per 10 minutes; the rest are in the log only


def source_for_path(path: str) -> str:
    p = path.lower()
    if "/resolve" in p:
        return "resolver"
    if "/ai" in p or "/watch-ai" in p:
        return "ai"
    if "sync" in p:
        return "sync"
    if "subtitle" in p:
        return "subtitles"
    return "server"


def source_for_logger(name: str) -> str:
    n = name.lower()
    for key, source in (("ai_service", "ai"), ("watch_ai", "ai"), ("resolver", "resolver"), ("sync", "sync"), ("subtitle", "subtitles"), ("tmdb", "tmdb")):
        if key in n:
            return source
    return "server"


def fingerprint(source: str, title: str, where: str | None) -> str:
    # Numbers, ids and quoted bits change between repeats of the same problem; leave them out.
    flat = re.sub(r"[0-9a-f]{8,}|\d+", "#", f"{source}|{title}|{where or ''}".lower())
    return hashlib.sha1(flat.encode()).hexdigest()


def format_exception(exc: BaseException) -> str:
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:]


def _within_burst() -> bool:
    now = time.monotonic()
    while _sent and now - _sent[0] > BURST[1]:
        _sent.pop(0)
    if len(_sent) >= BURST[0]:
        return False
    _sent.append(now)
    return True


def _message(source: str, level: str, title: str, where: str | None, user: str | None, detail: str | None) -> str:
    icon = ICONS.get(source, "🔥") if level == "error" else "⚠️"
    head = f"{icon} <b>{telegram_service.esc(title[:200])}</b>"
    lines = [head, f"{telegram_service.esc(source)} · {level}"]
    if where:
        lines.append(telegram_service.esc(where[:200]))
    if user:
        lines.append(f"Person: {telegram_service.esc(user)}")
    if detail:
        lines.append(f"<pre>{telegram_service.esc(detail.strip()[-600:])}</pre>")
    return "\n".join(lines)


async def record_now(
    source: str,
    title: str,
    detail: str | None = None,
    *,
    level: str = "error",
    where: str | None = None,
    user: str | None = None,
    telegram: bool | str = True,
) -> bool:
    """Writes one entry. `telegram` may be a ready message to send instead of the standard one. True when stored."""
    source = source if source in SOURCES else "server"
    title = " ".join(str(title).split())[:300] or "Unknown problem"
    fp = fingerprint(source, title, where)
    now = datetime.now(timezone.utc)
    is_new = False
    try:
        async with AsyncSessionLocal() as db:
            same = (
                await db.execute(
                    select(ErrorLog).where(ErrorLog.fingerprint == fp, ErrorLog.last_seen >= now - timedelta(minutes=REPEAT_MINUTES)).order_by(ErrorLog.last_seen.desc()).limit(1)
                )
            ).scalar_one_or_none()
            if same:
                same.count += 1
                same.last_seen = now
                if detail:
                    same.detail = detail[-4000:]
                if level == "error":
                    same.level = "error"
            else:
                is_new = True
                db.add(ErrorLog(source=source, level=level, title=title, detail=detail[-4000:] if detail else None, where=(where or None) and where[:300], user_name=user, fingerprint=fp, created_at=now, last_seen=now))
            await db.commit()
    except Exception:
        # The database may be the very thing that failed: Telegram still hears about it.
        is_new = True
        logging.getLogger("app.errorlog.fallback").debug("Couldn't store an error log entry", exc_info=True)
    if is_new and telegram and level == "error":
        if _within_burst():
            text = telegram if isinstance(telegram, str) else _message(source, level, title, where, user, detail)
            await telegram_service.send(TOPIC.get(source, "errors"), text)
    return True


def record(source: str, title: str, detail: str | None = None, **kw) -> None:
    """Fire-and-forget version: safe to call anywhere (also from sync code); does nothing without a running loop."""
    try:
        task = asyncio.get_running_loop().create_task(record_now(source, title, detail, **kw))
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


class LogHandler(logging.Handler):
    """Sends every ERROR (and every WARNING of the app's own loggers) to the error log.
    A record can opt out with `extra={"skip_errorlog": True}` when it is reported another way."""

    def emit(self, rec: logging.LogRecord) -> None:
        try:
            if rec.levelno < logging.WARNING or getattr(rec, "skip_errorlog", False):
                return
            if not rec.name.startswith("app."):
                return
            if rec.name.startswith(("app.services.error_log_service", "app.services.telegram_service", "app.errorlog")):
                return
            title = rec.getMessage()
            detail = None
            if rec.exc_info and rec.exc_info[1]:
                detail = format_exception(rec.exc_info[1])
                title = f"{title} ({type(rec.exc_info[1]).__name__})"
            record(source_for_logger(rec.name), title, detail, level="error" if rec.levelno >= logging.ERROR else "warning", where=rec.name.removeprefix("app."))
        except Exception:
            pass


def install_log_handler() -> None:
    root = logging.getLogger()
    if not any(isinstance(h, LogHandler) for h in root.handlers):
        root.addHandler(LogHandler(level=logging.WARNING))


async def cleanup() -> int:
    """Old entries go: handled ones after a week, everything after KEEP_DAYS, and never more than MAX_ROWS."""
    now = datetime.now(timezone.utc)
    removed = 0
    async with AsyncSessionLocal() as db:
        res = await db.execute(delete(ErrorLog).where(ErrorLog.created_at < now - timedelta(days=KEEP_DAYS)))
        removed += res.rowcount or 0
        res = await db.execute(delete(ErrorLog).where(ErrorLog.handled.is_(True), ErrorLog.last_seen < now - timedelta(days=7)))
        removed += res.rowcount or 0
        total = (await db.execute(select(func.count()).select_from(ErrorLog))).scalar_one()
        if total > MAX_ROWS:
            cutoff = (await db.execute(select(ErrorLog.created_at).order_by(ErrorLog.created_at.desc()).offset(MAX_ROWS).limit(1))).scalar_one_or_none()
            if cutoff:
                res = await db.execute(delete(ErrorLog).where(ErrorLog.created_at <= cutoff))
                removed += res.rowcount or 0
        await db.commit()
    return removed
