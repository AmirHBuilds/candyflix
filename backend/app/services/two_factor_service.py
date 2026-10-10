"""
Two-step sign-in through the Telegram bot.

Turning it on: Settings shows a link to the bot carrying a one-time token; opening it and pressing
Start tells the bot which CandyFlix account the chat belongs to. After that, a right password is
followed by a 6-digit code sent to that chat, and the code has to be typed in too.

The bot learns about those Start messages by long polling (no public address needed), run as a
background task of the backend when TELEGRAM_BOT_TOKEN is set.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AsyncSessionLocal as async_session_factory
from app.core.redis import get_redis
from app.models.user import User
from app.services import telegram_service

logger = logging.getLogger(__name__)

LINK_PREFIX = "2fa:link:"
CHALLENGE_PREFIX = "2fa:challenge:"
LINK_TTL = 600
CODE_TTL = 300
MAX_TRIES = 5
RESEND_AFTER = 30

_bot_username: str | None = None


class TwoFactorError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _hash(code: str, challenge: str) -> str:
    return hashlib.sha256(f"{challenge}:{code}".encode()).hexdigest()


async def bot_username() -> str | None:
    global _bot_username
    if _bot_username is None:
        me = await telegram_service.call("getMe", {})
        _bot_username = (me or {}).get("username")
    return _bot_username


# ---------- turning it on ----------


async def start_link(user: User) -> str:
    if not telegram_service.enabled():
        raise TwoFactorError("Telegram isn't set up on this server.", 503)
    name = await bot_username()
    if not name:
        raise TwoFactorError("Couldn't reach the Telegram bot. Try again in a moment.", 503)
    token = secrets.token_urlsafe(16)
    await get_redis().set(LINK_PREFIX + token, str(user.id), ex=LINK_TTL)
    return f"https://t.me/{name}?start={token}"


async def link_chat(db: AsyncSession, token: str, chat_id: int) -> str:
    """Called when someone presses Start in the bot. Returns what to answer them."""
    redis = get_redis()
    raw = await redis.getdel(LINK_PREFIX + token)
    if not raw:
        return "That link has expired. Open Settings in CandyFlix and turn two-step sign-in on again."
    user = await db.get(User, uuid.UUID(raw))
    if user is None:
        return "That account no longer exists."
    taken = await db.scalar(select(User.id).where(User.telegram_chat_id == chat_id, User.id != user.id))
    if taken:
        return "This Telegram account is already connected to another CandyFlix account."
    name = user.display_name
    user.telegram_chat_id = chat_id
    await db.commit()
    telegram_service.notify("accounts", f"🔐 <b>{telegram_service.esc(name)}</b> turned on two-step sign-in")
    return f"✅ Done, {name}. From now on I'll send you a code whenever you sign in to CandyFlix."


async def turn_off(db: AsyncSession, user: User, *, by: str | None = None) -> None:
    name = user.display_name
    user.telegram_chat_id = None
    await db.commit()
    who = f" (by {telegram_service.esc(by)})" if by else ""
    telegram_service.notify("accounts", f"🔓 <b>{telegram_service.esc(name)}</b> two-step sign-in turned off{who}")


# ---------- signing in ----------


async def begin_login(user: User) -> str:
    """The password was right: send a code to their chat and return the challenge id."""
    if user.telegram_chat_id is None:
        raise TwoFactorError("Two-step sign-in is not on for this account.")
    challenge = secrets.token_urlsafe(24)
    await _send_code(user.telegram_chat_id, challenge, str(user.id))
    return challenge


async def _send_code(chat_id: int, challenge: str, user_id: str) -> None:
    code = f"{secrets.randbelow(1_000_000):06d}"
    if not await telegram_service.send_to_chat(chat_id, f"🍬 Your CandyFlix sign-in code is <code>{code}</code>\nIt works for 5 minutes. If this wasn't you, don't share it."):
        raise TwoFactorError("Couldn't send the code to Telegram. Ask an admin to switch two-step sign-in off for you.", 503)
    data = {"user_id": user_id, "hash": _hash(code, challenge), "tries": 0, "sent": time.time()}
    await get_redis().set(CHALLENGE_PREFIX + challenge, json.dumps(data), ex=CODE_TTL)


async def resend(db: AsyncSession, challenge: str) -> None:
    redis = get_redis()
    raw = await redis.get(CHALLENGE_PREFIX + challenge)
    if not raw:
        raise TwoFactorError("That sign-in took too long. Start again.", 410)
    data = json.loads(raw)
    if time.time() - data["sent"] < RESEND_AFTER:
        raise TwoFactorError("Wait a few seconds before asking for another code.", 429)
    user = await db.get(User, uuid.UUID(data["user_id"]))
    if user is None or user.telegram_chat_id is None:
        raise TwoFactorError("Start again.", 410)
    await _send_code(user.telegram_chat_id, challenge, data["user_id"])


async def verify(db: AsyncSession, challenge: str, code: str) -> User:
    """Checks the typed code; at most MAX_TRIES wrong tries per challenge. A right code is used up."""
    redis = get_redis()
    key = CHALLENGE_PREFIX + challenge
    raw = await redis.get(key)
    if not raw:
        raise TwoFactorError("That code has expired. Sign in again.", 410)
    data = json.loads(raw)
    if data["tries"] >= MAX_TRIES:
        await redis.delete(key)
        raise TwoFactorError("Too many wrong codes. Sign in again.", 429)
    if not hmac.compare_digest(_hash(code.strip(), challenge), data["hash"]):
        data["tries"] += 1
        ttl = max(1, await redis.ttl(key))
        await redis.set(key, json.dumps(data), ex=ttl)
        telegram_service.report_failed_sign_in("(wrong two-step code)", None, "wrong code")
        raise TwoFactorError("That code isn't right.", 401)
    await redis.delete(key)
    user = await db.get(User, uuid.UUID(data["user_id"]))
    if user is None or user.is_disabled:
        raise TwoFactorError("This account can't sign in.", 403)
    return user


# ---------- the bot listening for Start ----------


async def handle_update(update_obj: dict) -> None:
    msg = update_obj.get("message") or {}
    chat = msg.get("chat") or {}
    text = (msg.get("text") or "").strip()
    if chat.get("type") != "private" or not text:
        return
    chat_id = chat["id"]
    parts = text.split(maxsplit=1)
    if parts[0].split("@")[0] == "/start" and len(parts) == 2:
        async with async_session_factory() as db:
            answer = await link_chat(db, parts[1].strip(), chat_id)
    else:
        answer = "Hi! I send CandyFlix sign-in codes. To connect your account, open Settings → Security in CandyFlix and turn on two-step sign-in."
    await telegram_service.send_to_chat(chat_id, answer)


async def poll_forever() -> None:
    """Long-polls the bot for messages. Never raises; stops when cancelled."""
    offset = 0
    while True:
        try:
            updates = await telegram_service.call("getUpdates", {"offset": offset, "timeout": 25, "allowed_updates": ["message"]}, timeout=35)
            if updates is None:
                await asyncio.sleep(5)
                continue
            for u in updates:
                offset = u["update_id"] + 1
                try:
                    await handle_update(u)
                except Exception:
                    logger.exception("Couldn't handle a Telegram message")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Telegram polling hiccup")
            await asyncio.sleep(5)
