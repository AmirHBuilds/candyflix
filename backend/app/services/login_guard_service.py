"""Limits on guessing passwords.

Wrong passwords are counted two ways, both in Redis with an automatic expiry:
- per account name (lower-cased, so "Candy" and "candy" are one), and
- per address (the visitor's IP).
Reaching the limit blocks further tries for a while. The block doubles when it happens again within a day (up to 4x),
and stays short on purpose so a stranger can't keep someone out for long. A blocked try gets the same message even when the
password is right, so a limit never tells a guesser they were correct. The one exception is the name limit, which lets through
an address the person has already signed in from (so a stranger hammering a name can't lock the real person out at home).

Every wrong try and every block is also written to the `login_events` table for the admin's Security tab."""
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AsyncSessionLocal
from app.core.redis import get_redis
from app.models.audit import SignInLog
from app.models.login_event import LoginEvent
from app.schemas.site import LoginGuardConfig
from app.services import notice_service, telegram_service

P = "lg:"
KEEP_DAYS = 30
MAX_ROWS = 5000
STRIKES_TTL = 24 * 3600
KNOWN_ADDRESS_DAYS = 30
MESSAGE = "Too many tries. Please wait a few minutes and try again."


def norm_name(name: str) -> str:
    return (name or "").strip().lower()[:100]


def norm_ip(ip: str | None) -> str:
    return (ip or "unknown")[:45]


@dataclass
class Block:
    scope: str  # "name" | "ip"
    key: str
    seconds_left: int
    since: datetime | None = None
    until: datetime | None = None
    fails: int = 0
    minutes: int = 0
    strikes: int = 1
    others: list[str] | None = None  # name block: addresses it came from; address block: names that were tried


def _wait_text(seconds: int) -> str:
    minutes = max(1, round(seconds / 60))
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def message_for(seconds: int) -> str:
    return f"Too many tries. Please wait about {_wait_text(seconds)} and try again."


async def check(name: str, ip: str | None) -> Block | None:
    """The block that applies right now (the longer one if both do), or None."""
    r = get_redis()
    found: list[Block] = []
    for scope, key in (("name", norm_name(name)), ("ip", norm_ip(ip))):
        ttl = await r.ttl(f"{P}{scope[0]}b:{key}")
        if ttl and ttl > 0:
            found.append(Block(scope=scope, key=key, seconds_left=int(ttl)))
    return max(found, key=lambda b: b.seconds_left) if found else None


async def is_known_address(db: AsyncSession, name: str, ip: str | None) -> bool:
    """Has this person (by exact username) signed in from this address in the last 30 days?"""
    if not ip:
        return False
    from app.models.user import User

    since = datetime.now(timezone.utc) - timedelta(days=KNOWN_ADDRESS_DAYS)
    q = (
        select(SignInLog.id)
        .join(User, User.id == SignInLog.user_id)
        .where(User.username == name, SignInLog.ip == ip, SignInLog.at > since)
        .limit(1)
    )
    return (await db.execute(q)).first() is not None


async def _make_block(scope: str, key: str, fails: int, others: list[str], cfg: LoginGuardConfig) -> Block | None:
    r = get_redis()
    strikes = int(await r.get(f"{P}{scope[0]}s:{key}") or 0) + 1
    minutes = cfg.lockout_minutes * min(2 ** (strikes - 1), 4)
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=minutes)
    value = json.dumps({"since": now.isoformat(), "until": until.isoformat(), "fails": fails, "minutes": minutes, "strikes": strikes, "others": others[:20]})
    # nx: two failures racing at the limit make one block (and one alert), not two
    if not await r.set(f"{P}{scope[0]}b:{key}", value, ex=minutes * 60, nx=True):
        return None
    await r.incr(f"{P}{scope[0]}s:{key}")
    await r.expire(f"{P}{scope[0]}s:{key}", STRIKES_TTL)
    await r.delete(f"{P}{scope[0]}f:{key}")  # a fresh count once the block is over
    return Block(scope=scope, key=key, seconds_left=minutes * 60, since=now, until=until, fails=fails, minutes=minutes, strikes=strikes, others=others)


async def _count(key: str, window: int) -> int:
    r = get_redis()
    n = int(await r.incr(key))
    if n == 1:
        await r.expire(key, window)
    return n


async def record_failure(name: str, ip: str | None, cfg: LoginGuardConfig) -> list[Block]:
    """Counts one wrong password; returns the blocks it just caused (usually none)."""
    r = get_redis()
    n, i, window = norm_name(name), norm_ip(ip), cfg.window_minutes * 60
    nc = await _count(f"{P}nf:{n}", window)
    ic = await _count(f"{P}if:{i}", window)
    if await r.scard(f"{P}nips:{n}") < 20:
        await r.sadd(f"{P}nips:{n}", i)
        await r.expire(f"{P}nips:{n}", window)
    if await r.scard(f"{P}inames:{i}") < 20:
        await r.sadd(f"{P}inames:{i}", n)
        await r.expire(f"{P}inames:{i}", window)
    made: list[Block] = []
    if nc >= cfg.name_failures:
        b = await _make_block("name", n, nc, sorted(await r.smembers(f"{P}nips:{n}")), cfg)
        if b:
            made.append(b)
    if ic >= cfg.ip_failures:
        b = await _make_block("ip", i, ic, sorted(await r.smembers(f"{P}inames:{i}")), cfg)
        if b:
            made.append(b)
    return made


async def record_success(name: str) -> None:
    """A right password ends the run of wrong ones for that name."""
    r = get_redis()
    n = norm_name(name)
    await r.delete(f"{P}nf:{n}", f"{P}nips:{n}")


async def list_blocks() -> list[Block]:
    r = get_redis()
    out: list[Block] = []
    for scope in ("name", "ip"):
        async for rkey in r.scan_iter(match=f"{P}{scope[0]}b:*", count=200):
            ttl = await r.ttl(rkey)
            raw = await r.get(rkey)
            if raw is None or not ttl or ttl <= 0:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                data = {}
            out.append(
                Block(
                    scope=scope,
                    key=rkey.split(":", 2)[2],
                    seconds_left=int(ttl),
                    since=datetime.fromisoformat(data["since"]) if data.get("since") else None,
                    until=datetime.fromisoformat(data["until"]) if data.get("until") else None,
                    fails=int(data.get("fails") or 0),
                    minutes=int(data.get("minutes") or 0),
                    strikes=int(data.get("strikes") or 1),
                    others=data.get("others") or [],
                )
            )
    return sorted(out, key=lambda b: -b.seconds_left)


async def clear(scope: str, key: str) -> bool:
    """Lifts a block and forgets the count and the repeats. True if there was a block."""
    r = get_redis()
    k = norm_name(key) if scope == "name" else norm_ip(key)
    s = scope[0]
    removed = await r.delete(f"{P}{s}b:{k}")
    await r.delete(f"{P}{s}f:{k}", f"{P}{s}s:{k}", f"{P}nips:{k}" if scope == "name" else f"{P}inames:{k}")
    return bool(removed)


# ---------- the record (database) ----------


async def add_event(kind: str, username: str | None, ip: str | None, detail: str | None = None) -> None:
    """Own session; never raises: keeping the record must not break a sign-in."""
    try:
        async with AsyncSessionLocal() as db:
            db.add(LoginEvent(kind=kind, username=(username or None) and username[:100], ip=(ip or None) and ip[:45], detail=(detail or None) and detail[:200]))
            await db.commit()
    except Exception:
        pass


async def events(db: AsyncSession, limit: int = 100) -> list[LoginEvent]:
    return list((await db.execute(select(LoginEvent).order_by(LoginEvent.at.desc()).limit(limit))).scalars().all())


async def cleanup() -> int:
    now = datetime.now(timezone.utc)
    removed = 0
    async with AsyncSessionLocal() as db:
        res = await db.execute(delete(LoginEvent).where(LoginEvent.at < now - timedelta(days=KEEP_DAYS)))
        removed += res.rowcount or 0
        total = (await db.execute(select(func.count()).select_from(LoginEvent))).scalar_one()
        if total > MAX_ROWS:
            cutoff = (await db.execute(select(LoginEvent.at).order_by(LoginEvent.at.desc()).offset(MAX_ROWS).limit(1))).scalar_one_or_none()
            if cutoff:
                res = await db.execute(delete(LoginEvent).where(LoginEvent.at <= cutoff))
                removed += res.rowcount or 0
        await db.commit()
    return removed


# ---------- what the login route calls ----------


def _who(block: Block) -> str:
    return f"the name “{block.key}”" if block.scope == "name" else f"the address {block.key}"


async def failed(name: str, ip: str | None, why: str, cfg: LoginGuardConfig) -> None:
    """One wrong password: written down, counted, and (if it tipped a limit) announced."""
    await add_event("failed", name, ip, why)
    if not cfg.enabled:
        return
    for block in await record_failure(name, ip, cfg):
        what = f"{block.fails} wrong passwords"
        detail = f"{what}; blocked for {block.minutes} min" + (f" (repeat #{block.strikes})" if block.strikes > 1 else "")
        await add_event("blocked", block.key if block.scope == "name" else None, block.key if block.scope == "ip" else ip, f"{block.scope}: {detail}")
        telegram_service.report_login_blocked(block.scope, block.key, block.fails, block.minutes, block.others or [])
        await notice_service.add(
            "security",
            f"Sign-in blocked for {_who(block)}",
            f"{detail}. " + (f"From: {', '.join(block.others[:5])}" if block.scope == "name" and block.others else f"Names tried: {', '.join(block.others[:5])}" if block.others else ""),
            link="security",
        )
