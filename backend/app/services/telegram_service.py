"""
Telegram reports: the important things that happen, posted into a group chat, one topic per kind.

Configured only from the environment (TELEGRAM_*). Sending is fire-and-forget: it never delays a
request and never raises, so Telegram being down (or not set up) cannot break the site. Nothing
private is sent: no passwords, no watch history, no AI prompts.
"""
import asyncio
import html
import logging
import time

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Which environment variable names the topic for each kind of report.
TOPICS = ("sign_ins", "accounts", "admin", "ai", "security", "errors", "system")

_tasks: set[asyncio.Task] = set()
_recent: dict[str, float] = {}
DEDUPE_SECONDS = 60


def enabled() -> bool:
    s = get_settings()
    return bool(s.telegram_bot_token and s.telegram_chat_id)


def topic_id(topic: str) -> int | None:
    raw = getattr(get_settings(), f"telegram_topic_{topic}", "").strip()
    return int(raw) if raw.lstrip("-").isdigit() else None


def esc(value: object) -> str:
    return html.escape(str(value), quote=False)


def _is_repeat(key: str) -> bool:
    now = time.monotonic()
    for k in [k for k, t in _recent.items() if now - t > DEDUPE_SECONDS]:
        del _recent[k]
    if key in _recent:
        return True
    _recent[key] = now
    return False


async def send(topic: str, text: str) -> bool:
    """Post one message to a topic. Returns whether Telegram accepted it."""
    s = get_settings()
    if not enabled() or topic not in TOPICS:
        return False
    body: dict = {"chat_id": s.telegram_chat_id, "text": text[:3900], "parse_mode": "HTML", "disable_web_page_preview": True}
    thread = topic_id(topic)
    if thread is not None:
        body["message_thread_id"] = thread
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.post(f"{s.telegram_base_url}/bot{s.telegram_bot_token}/sendMessage", json=body)
        if res.status_code != 200:
            logger.warning("Telegram refused a %s report: HTTP %s", topic, res.status_code)
            return False
        return True
    except Exception:
        logger.warning("Couldn't reach Telegram for a %s report", topic)
        return False


async def call(method: str, body: dict, timeout: float = 8) -> dict | None:
    """One Bot API call. Returns the `result`, or None if it failed."""
    s = get_settings()
    if not s.telegram_bot_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{s.telegram_base_url}/bot{s.telegram_bot_token}/{method}", json=body)
        data = res.json()
        return data.get("result") if res.status_code == 200 and data.get("ok") else None
    except Exception:
        logger.warning("Telegram call %s failed", method)
        return None


async def send_to_chat(chat_id: int, text: str) -> bool:
    """A private message to one person's chat (used for sign-in codes). Awaited, unlike reports."""
    return await call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}) is not None


def notify(topic: str, text: str, *, dedupe: bool = False) -> None:
    """Queue a report and return at once. Safe to call anywhere, with or without a running loop."""
    if not enabled():
        return
    if dedupe and _is_repeat(f"{topic}:{text}"):
        return
    try:
        task = asyncio.get_running_loop().create_task(send(topic, text))
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


# ---------- the reports ----------

ADMIN_ACTIONS = {
    "user.update": ("accounts", "✏️ Account changed"),
    "user.disable": ("accounts", "⛔ Account switched off"),
    "user.enable": ("accounts", "✅ Account switched on"),
    "user.make_admin": ("accounts", "👑 Made an admin"),
    "user.remove_admin": ("accounts", "👑 Admin removed"),
    "user.password_reset": ("accounts", "🔑 Password reset"),
    "user.delete": ("accounts", "🗑 Account deleted"),
    "user.create": ("accounts", "🆕 New account"),
}


def report_admin_action(actor_name: str, action: str, target: str | None, detail: str | None) -> None:
    if action == "user.2fa_off":  # already reported, with who did it, by two_factor_service.turn_off
        return
    topic, title = ADMIN_ACTIONS.get(action, ("admin", f"🛠 {action}"))
    lines = [f"<b>{esc(title)}</b>", f"By {esc(actor_name)}"]
    if target:
        lines.insert(1, esc(target))
    if detail:
        lines.append(esc(detail))
    notify(topic, "\n".join(lines))


def report_sign_in(name: str, device: str) -> None:
    notify("sign_ins", f"🔓 <b>{esc(name)}</b> signed in\n{esc(device)}")


def report_failed_sign_in(username: str, ip: str | None, why: str) -> None:
    notify("security", f"⚠️ <b>Sign-in refused</b>\nName tried: {esc(username[:60])}\nReason: {esc(why)}\nFrom: {esc(ip or 'unknown')}", dedupe=True)


def report_model_paused(model: str, seconds: int) -> None:
    hours, minutes = divmod(max(1, seconds) // 60, 60)
    notify("ai", f"🚦 <b>{esc(model)}</b> hit its limit\nResting {hours}h {minutes}m. The backup model is used meanwhile.", dedupe=True)


def report_error(method: str, path: str, error: Exception) -> None:
    notify("errors", f"🔥 <b>Server error</b>\n{esc(method)} {esc(path)}\n{esc(type(error).__name__)}: {esc(str(error)[:300])}", dedupe=True)


def report_started() -> None:
    notify("system", "🟢 <b>CandyFlix started</b>")
