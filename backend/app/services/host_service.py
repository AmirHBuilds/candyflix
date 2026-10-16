"""What the server itself is doing: disk, memory, CPU, uptime, and how big the database, Redis and the caches are.
Read from /proc and the standard library (no extra package). On a system without /proc a value is simply missing."""
import asyncio
import os
import shutil
import time
from pathlib import Path

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.services import presence_service

STARTED = time.time()


def _read(path: str) -> str | None:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def memory() -> dict | None:
    raw = _read("/proc/meminfo")
    if not raw:
        return None
    info = {}
    for line in raw.splitlines():
        k, _, v = line.partition(":")
        parts = v.split()
        if parts:
            info[k] = int(parts[0]) * 1024
    total, avail = info.get("MemTotal", 0), info.get("MemAvailable", info.get("MemFree", 0))
    out = {"total": total, "available": avail, "used": max(total - avail, 0), "swap_total": info.get("SwapTotal", 0), "swap_used": max(info.get("SwapTotal", 0) - info.get("SwapFree", 0), 0)}
    # Inside a container the limit that matters is the container's.
    limit = _read("/sys/fs/cgroup/memory.max")
    current = _read("/sys/fs/cgroup/memory.current")
    if limit and current and limit.strip().isdigit() and int(limit) < total:
        out.update(limit=int(limit), container_used=int(current))
    return out


def cpu() -> dict | None:
    raw = _read("/proc/loadavg")
    if not raw:
        return None
    one, five, fifteen = (float(x) for x in raw.split()[:3])
    return {"cores": os.cpu_count() or 1, "load_1": one, "load_5": five, "load_15": fifteen}


def uptimes() -> dict:
    host = None
    raw = _read("/proc/uptime")
    if raw:
        host = int(float(raw.split()[0]))
    rss = None
    status = _read("/proc/self/status")
    if status:
        for line in status.splitlines():
            if line.startswith("VmRSS:"):
                rss = int(line.split()[1]) * 1024
    return {"host_seconds": host, "app_seconds": int(time.time() - STARTED), "app_memory": rss}


def _disk(label: str, path: str) -> dict | None:
    try:
        target = path if Path(path).exists() else "/"
        du = shutil.disk_usage(target)
        return {"label": label, "path": path, "total": du.total, "used": du.used, "free": du.free, "device": os.stat(target).st_dev}
    except OSError:
        return None


def disks() -> list[dict]:
    s = get_settings()
    found = [_disk("Server disk", "/"), _disk("Video / sync data", s.sync_cache_dir), _disk("Subtitles and pictures", s.subtitle_cache_dir)]
    seen, out = set(), []
    for d in found:
        if d and d["device"] not in seen:  # one line per physical disk
            seen.add(d["device"])
            d.pop("device")
            out.append(d)
    return out


def _folder(label: str, directory: str) -> dict:
    files = size = 0
    path = Path(directory)
    if path.is_dir():
        for p in path.rglob("*"):
            try:
                if p.is_file() and p.name != ".gitkeep":
                    files += 1
                    size += p.stat().st_size
            except OSError:
                pass
    return {"label": label, "files": files, "bytes": size}


def folders() -> list[dict]:
    s = get_settings()
    return [_folder("Sync audio and speech maps", s.sync_cache_dir), _folder("Subtitle cache", s.subtitle_cache_dir), _folder("Profile pictures", s.avatars_dir)]


async def database(db: AsyncSession) -> dict | None:
    try:
        size = (await db.execute(text("SELECT pg_database_size(current_database())"))).scalar_one()
        conns = (await db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"))).scalar_one()
        return {"bytes": int(size), "connections": int(conns)}
    except Exception:
        return None


async def redis_info() -> dict | None:
    try:
        r = get_redis()
        info = await r.info("memory")
        return {"bytes": int(info.get("used_memory", 0)), "keys": int(await r.dbsize())}
    except Exception:
        return None


async def resolver_health() -> dict | None:
    s = get_settings()
    if not s.resolver_url:
        return None
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            res = await client.get(f"{s.resolver_url.rstrip('/')}/health")
        ms = round((time.perf_counter() - start) * 1000)
        return {"ok": res.status_code == 200, "detail": "Answering" if res.status_code == 200 else f"HTTP {res.status_code}", "latency_ms": ms}
    except httpx.RequestError as e:
        return {"ok": False, "detail": f"Can't reach it: {type(e).__name__}", "latency_ms": None}


async def snapshot(db: AsyncSession) -> dict:
    loop = asyncio.get_running_loop()
    folder_list = await loop.run_in_executor(None, folders)  # walking folders is blocking I/O
    db_info, redis_i, resolver, online = await asyncio.gather(database(db), redis_info(), resolver_health(), presence_service.list_now())
    return {
        "memory": memory(),
        "cpu": cpu(),
        "uptime": uptimes(),
        "disks": disks(),
        "folders": folder_list,
        "database": db_info,
        "redis": redis_i,
        "resolver": resolver,
        "watching_now": len(online),
    }
