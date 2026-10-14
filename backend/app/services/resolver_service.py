"""
Candy Resolver client (Phase 22): finds real video for a movie / episode, downloads it to the
resolver's server (as HLS, playable while it still downloads) and turns what it says into one
tidy state the player can show.

The browser never talks to the resolver's API (the key stays here). The video itself reaches the
browser one of two ways, chosen by RESOLVER_STREAM_MODE:
  proxy  - CandyFlix relays it (/api/resolve/relay). Works on localhost with no CORS on the resolver.
  direct - the browser plays the resolver's own signed link. Needs CORS on the resolver.
"""
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import re
from urllib.parse import quote, urljoin, urlparse

import httpx
from fastapi import HTTPException
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from app.core.config import get_settings
from app.core.redis import get_redis
from app.models.user import User
from app.schemas.resolve import ResolveState, SourceState, StreamState, SubtitleItem
from app.services import content_rating_service

# Tests point this at a fake resolver (an ASGI transport).
_transport: httpx.AsyncBaseTransport | None = None

UNAVAILABLE = "The video service isn't reachable right now. Try again in a moment."
_NOT_VIDEO = re.compile(r"thumb|sprite|storyboard|preview", re.I)
_URI_ATTR = re.compile(r'URI="([^"]+)"')


def enabled() -> bool:
    s = get_settings()
    return bool(s.resolver_url.strip() and s.resolver_api_key.strip())


def _base() -> str:
    return get_settings().resolver_url.strip().rstrip("/")


def _client(timeout: float = 15) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=_transport, timeout=httpx.Timeout(timeout, connect=8), follow_redirects=False)


async def _call(method: str, path: str, *, params: dict | None = None, json_body: dict | None = None, timeout: float = 15) -> dict | list:
    headers = {"x-api-key": get_settings().resolver_api_key}
    try:
        async with _client(timeout) as c:
            r = await c.request(method, f"{_base()}{path}", params=params, json=json_body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, UNAVAILABLE)
    if r.status_code == 404:
        raise HTTPException(404, "That video request has expired. Start again.")
    if r.status_code == 410:
        # The source's own link is dead (the resolver says so at once instead of starting a download that would fail).
        raise HTTPException(410, "source_link_expired")
    if r.status_code >= 400:
        raise HTTPException(502, UNAVAILABLE)
    return r.json()


# ---------------------------------------------------------------- helpers

def quality_rank(q: str | None) -> int:
    m = re.match(r"\s*(\d+)", q or "")
    return int(m.group(1)) if m else 0


def _label(q: str | None) -> str:
    if not q or q.lower() == "auto":
        return "Auto"
    return q


def public_url(url: str) -> str:
    """What the browser is given for a resolver link."""
    if get_settings().resolver_stream_mode.strip().lower() == "direct":
        return url
    return f"/api/resolve/relay?u={quote(url, safe='')}"


def _progress(item: dict) -> float | None:
    if item.get("status") == "ready":
        return 100.0
    size, total = item.get("size"), item.get("total_bytes")
    if size is not None and total:
        return max(0.0, min(100.0, size / total * 100))
    p = item.get("progress")
    if p is None:
        return None
    # The resolver may send a fraction (0-1) or a percentage (0-100).
    return max(0.0, min(100.0, p * 100 if p <= 1 else p))


def _duration(item: dict) -> float | None:
    d = item.get("duration_s")
    return float(d) if isinstance(d, (int, float)) and d > 0 else None


def _item_state(item: dict) -> str:
    status = (item.get("status") or "").lower()
    if status == "ready":
        return "ready"
    if status in ("failed", "error", "expired", "deleted"):
        return "failed"
    return "downloading"


def _best_item(items: list[dict]) -> dict:
    order = {"ready": 0, "downloading": 1, "failed": 2}
    return sorted(items, key=lambda i: order[_item_state(i)])[0]  # stable: the resolver lists newest first


def _stream_state(stream: dict | None, item: dict | None, stream_id: str, quality: str | None) -> StreamState:
    if item is None:
        return StreamState(stream_id=stream_id, quality=_label(quality), rank=quality_rank(quality), state="idle")
    state = _item_state(item)
    link = item.get("stream_url") or item.get("url")
    playable = state == "ready" or bool(item.get("playable"))
    return StreamState(
        stream_id=stream_id,
        quality=_label(quality or item.get("quality")),
        rank=quality_rank(quality or item.get("quality")),
        state=state,
        progress=_progress(item),
        duration_seconds=_duration(item),
        library_id=item.get("id"),
        play_url=public_url(link) if (playable and link and state != "failed") else None,
        error=(item.get("error") or ("This link expired." if item.get("error_code") == "source_link_expired" else None)) if state == "failed" else None,
    )


def _subtitle_items(raw: list[dict]) -> list[SubtitleItem]:
    out, seen = [], set()
    for s in raw or []:
        url = s.get("url")
        if not url or url in seen or _NOT_VIDEO.search(urlparse(url).path.rsplit("/", 1)[-1]):
            continue
        seen.add(url)
        fmt = "srt" if (s.get("format") or "vtt").lower() == "srt" else "vtt"
        lang = (s.get("lang") or "und").lower()
        out.append(
            SubtitleItem(
                language=lang,
                label=s.get("label") or ("Unknown" if lang == "und" else lang),
                url=public_url(url),
                format=fmt,
                source=s.get("source"),
                default=bool(s.get("default")),
            )
        )
    return out


def build_state(task: dict, extra_subtitles: list[dict], auto: str | None = None) -> ResolveState:
    items_by_stream: dict[str, list[dict]] = {}
    for it in task.get("library") or []:
        if it.get("mode") == "subs":
            continue
        items_by_stream.setdefault(it.get("stream_id"), []).append(it)

    sources: list[SourceState] = []
    known: set[str] = set()
    for src in task.get("sources") or []:
        streams = []
        for st in src.get("streams") or []:
            known.add(st["id"])
            item = _best_item(items_by_stream[st["id"]]) if st["id"] in items_by_stream else None
            streams.append(_stream_state(st, item, st["id"], st.get("quality")))
        streams.sort(key=lambda s: (s.rank == 0, -s.rank))
        sources.append(
            SourceState(name=src.get("source") or "Source", starred=bool(src.get("starred")), status=src.get("status") or "", error=src.get("error"), streams=streams)
        )
    # Downloads whose source list is gone (the task expired) still play.
    orphans: dict[str, list[StreamState]] = {}
    for sid, items in items_by_stream.items():
        if sid in known:
            continue
        item = _best_item(items)
        orphans.setdefault(item.get("source") or "Source", []).append(_stream_state(None, item, sid, item.get("quality")))
    for name, streams in orphans.items():
        streams.sort(key=lambda s: (s.rank == 0, -s.rank))
        sources.append(SourceState(name=name, status="ok", streams=streams))

    live_items = [i for items in items_by_stream.values() for i in items if _item_state(i) != "failed"]
    if auto is None and live_items:
        oldest = min(live_items, key=lambda i: i.get("requested_at") or "")
        auto = oldest.get("stream_id")

    raw_subs = list(extra_subtitles)
    for items in items_by_stream.values():
        for it in items:
            for s in it.get("subtitles") or []:
                raw_subs.append({**s, "source": s.get("source") or it.get("source")})

    status = task.get("status") or "running"
    return ResolveState(
        task_id=task["task_id"],
        status="expired" if status == "expired" else ("done" if status in ("done", "failed", "error") else "running"),
        version=task.get("version") or 0,
        sources_total=task.get("sources_total") or 0,
        sources_done=task.get("sources_done") or 0,
        queue_position=task.get("queue_position"),
        has_more=bool(task.get("has_more")),
        sources=sources,
        subtitles=_subtitle_items(raw_subs),
        auto_stream_id=auto,
    )


def dead_streams(task: dict) -> set[str]:
    """Streams whose link is known to be dead: a download of them failed because the source refused the link."""
    return {i.get("stream_id") for i in task.get("library") or [] if i.get("error_code") == "source_link_expired"}


def _past_expiry(stream: dict) -> bool:
    raw = stream.get("expires_at")
    if not raw:
        return False
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except ValueError:
        return False


def best_stream(task: dict, avoid: set[str] | None = None) -> dict | None:
    """The best quality of the first source that has a usable video (never a link known to be dead or past its expiry)."""
    skip = dead_streams(task) | (avoid or set())
    for src in task.get("sources") or []:
        if src.get("status") not in (None, "ok", "done"):
            continue
        streams = [st for st in src.get("streams") or [] if st["id"] not in skip and not _past_expiry(st)]
        if not streams:
            continue
        numbered = [st for st in streams if quality_rank(st.get("quality")) > 0]
        return max(numbered, key=lambda st: quality_rank(st.get("quality"))) if numbered else streams[0]
    return None


async def _task_subtitles(task: dict) -> list[dict]:
    """Subtitles of every source of a finished task, hosted by the resolver. Cached once ready."""
    tid = task["task_id"]
    if (task.get("status") or "") not in ("done", "failed", "error"):
        return []
    redis = get_redis()
    key = f"resolver:subs:{tid}"
    cached = await redis.get(key)
    if cached:
        return json.loads(cached)
    try:
        got = await _call("GET", f"/v1/tasks/{tid}/subtitles")
        if got.get("status") == "pending":
            return []
        subs = got.get("subtitles") or []
        await redis.set(key, json.dumps(subs), ex=1800)
        return subs
    except HTTPException:
        pass
    # Not asked for yet: ask once.
    if await redis.set(f"resolver:subs-asked:{tid}", "1", nx=True, ex=600):
        try:
            await _call("POST", f"/v1/tasks/{tid}/subtitles", json_body={"subtitle_langs": [], "subtitle_default": "en", "ttl_hours": get_settings().resolver_ttl_hours})
        except HTTPException:
            pass
    return []


# ---------------------------------------------------------------- operations

async def _guard(user: User, task: dict) -> None:
    await content_rating_service.ensure(user, task["type"], task["tmdb_id"])


async def get_state(user: User, task_id: str, after: int | None = None, wait_s: int = 0) -> ResolveState:
    params: dict = {}
    if after is not None and wait_s:
        params = {"after": after, "wait_s": min(wait_s, 25)}
    task = await _call("GET", f"/v1/tasks/{task_id}", params=params, timeout=15 + wait_s)
    await _guard(user, task)
    return build_state(task, await _task_subtitles(task))


MAX_LINK_TRIES = 3  # a dead link is never retried; at most this many different ones are tried before giving up


async def request_download(user: User, task_id: str, stream_id: str | None, _tries: int = 0, _auto: bool | None = None) -> ResolveState:
    s = get_settings()
    auto = (stream_id is None) if _auto is None else _auto  # nobody picked a quality: a new search is allowed if needed
    task = await _call("GET", f"/v1/tasks/{task_id}")
    await _guard(user, task)

    if task.get("status") == "expired" and not [i for i in task.get("library") or [] if _item_state(i) != "failed"]:
        # Nothing of this search is left: ask again from scratch (only when the person did not pick one quality).
        if auto:
            return await _fresh_search(user, task, _tries)
        raise HTTPException(410, "That video request has expired. Start again.")

    if stream_id is None:
        chosen = best_stream(task)
        if chosen is None:
            return await _after_dead_link(user, task, None, _tries, allow_new_task=auto)
        stream_id = chosen["id"]
    known = {st["id"] for src in task.get("sources") or [] for st in src.get("streams") or []}
    known |= {i.get("stream_id") for i in task.get("library") or []}
    if stream_id not in known:
        raise HTTPException(404, "That quality isn't available.")
    if stream_id in dead_streams(task):
        # The source refused this link before: never ask for it again, use another one.
        return await _after_dead_link(user, task, stream_id, _tries, allow_new_task=auto)

    already = [i for i in task.get("library") or [] if i.get("stream_id") == stream_id and i.get("mode") != "subs" and _item_state(i) != "failed"]
    if not already:
        redis = get_redis()
        rk = f"resolver:dl:{user.id}"
        used = await redis.incr(rk)
        if used == 1:
            await redis.expire(rk, 60)
        if used > s.resolver_downloads_per_minute:
            raise HTTPException(429, "Slow down a little. Try again in a moment.")
        try:
            item = await _call(
                "POST",
                f"/v1/tasks/{task_id}/library",
                json_body={
                    "stream_id": stream_id,
                    "ttl_hours": s.resolver_ttl_hours,
                    "progressive": True,
                    "subtitles": True,
                    "subtitle_langs": [],
                    "subtitle_default": "en",
                },
            )
        except HTTPException as e:
            if e.status_code != 410:
                raise
            return await _after_dead_link(user, task, stream_id, _tries, allow_new_task=auto)
        task = {**task, "library": [item, *(task.get("library") or [])]}
    return build_state(task, await _task_subtitles(task))


async def _after_dead_link(user: User, task: dict, bad: str | None, tries: int, allow_new_task: bool) -> ResolveState:
    """The link of `bad` (or every link of the task) is dead. In order: another stream of this task, more sources of this
    task, and (only when nobody picked a quality) a brand-new search. Never the same link twice; gives up after a few."""
    tid = task["task_id"]
    if tries + 1 >= MAX_LINK_TRIES:
        raise HTTPException(502, "This video's links have expired. Try again in a moment.")
    avoid = {bad} if bad else set()
    fresh = await _call("GET", f"/v1/tasks/{tid}")  # the resolver now leaves dead links out
    other = best_stream(fresh, avoid)
    if other is not None:
        return await request_download(user, tid, other["id"], tries + 1, allow_new_task)
    if fresh.get("has_more"):
        more = await _call("POST", f"/v1/tasks/{tid}/sources", params={"wait": "first", "wait_s": 20}, json_body={"count": get_settings().resolver_more_default}, timeout=35)
        other = best_stream(more, avoid)
        if other is not None:
            return await request_download(user, tid, other["id"], tries + 1, allow_new_task)
    if allow_new_task:
        return await _fresh_search(user, fresh, tries + 1)
    raise HTTPException(410, "That quality's link has expired. Try another one.")


async def _fresh_search(user: User, old: dict, tries: int) -> ResolveState:
    """A new search for the same movie / episode (new links), then the best of its first source."""
    if tries + 1 >= MAX_LINK_TRIES:
        raise HTTPException(502, "This video's links have expired. Try again in a moment.")
    s = get_settings()
    body: dict = {"tmdb_id": old["tmdb_id"], "type": old["type"], "starred_first": s.resolver_starred_first}
    if old.get("type") == "tv":
        body.update(season=old.get("season"), episode=old.get("episode"))
    if s.resolver_first_sources > 0:
        body["max_sources"] = min(s.resolver_first_sources, 50)
    wait = min(max(s.resolver_first_wait_s, 1), 30)
    task = await _call("POST", "/v1/resolve", params={"wait": "first", "wait_s": wait}, json_body=body, timeout=wait + 15)
    if best_stream(task):
        return await request_download(user, task["task_id"], None, tries + 1, True)
    return build_state(task, [])


async def prefetch(user: User, media_type: str, tmdb_id: int, season: int | None, episode: int | None) -> bool:
    """Gets a title ready before anyone presses play (the next episode, near the end of this one): the same as opening
    it (reuse what is there, else search and download the best quality of the first source). Once an hour per person and
    episode; never raises, because nobody is waiting for it. True when something was started or already there."""
    try:
        redis = get_redis()
        if not await redis.set(f"resolver:prefetch:{user.id}:{media_type}:{tmdb_id}:{season}:{episode}", "1", nx=True, ex=3600):
            return False
        await start(user, media_type, tmdb_id, season, episode)
        return True
    except Exception:
        return False


async def more_sources(user: User, task_id: str, everything: bool) -> ResolveState:
    """Asks the resolver for more sources of a finished search: about half of them the first time, all the rest after."""
    s = get_settings()
    task = await _call("GET", f"/v1/tasks/{task_id}")
    await _guard(user, task)
    if task.get("status") == "running" or not task.get("has_more"):
        # Still searching (a second click must not stack another search), or nothing is left to ask.
        return build_state(task, await _task_subtitles(task))
    if everything:
        count = 50
    else:
        total = int(task.get("sources_total") or 0)
        count = -(-total // 2) if total > 1 else s.resolver_more_default
    count = max(1, min(count, 50))
    task = await _call("POST", f"/v1/tasks/{task_id}/sources", json_body={"count": count})
    return build_state(task, await _task_subtitles(task))


async def start(user: User, media_type: str, tmdb_id: int, season: int | None, episode: int | None) -> ResolveState:
    if media_type == "tv" and (season is None or episode is None):
        raise HTTPException(422, "A series needs a season and an episode.")
    await content_rating_service.ensure(user, media_type, tmdb_id)
    s = get_settings()

    # Already downloaded, or still downloading from before a page refresh? Carry on with that instead of
    # starting over: ready first (best quality), then one that already plays, then any that is on its way.
    params = {"tmdb_id": tmdb_id, "type": media_type, "limit": 30}
    if media_type == "tv":
        params.update(season=season, episode=episode)
    try:
        lib = await _call("GET", "/v1/library", params=params)
    except HTTPException:
        lib = []
    usable = [i for i in lib if i.get("mode") != "subs" and _item_state(i) != "failed" and i.get("task_id")]

    def rank(i: dict) -> tuple:
        ready = _item_state(i) == "ready" and bool(i.get("stream_url") or i.get("url"))
        return (0 if ready else 1 if i.get("playable") else 2, -quality_rank(i.get("quality")))

    if usable:
        best = sorted(usable, key=rank)[0]
        try:
            task = await _call("GET", f"/v1/tasks/{best['task_id']}")
        except HTTPException:
            task = {"task_id": best["task_id"], "status": "expired", "type": media_type, "tmdb_id": tmdb_id, "sources": [], "library": []}
        have = {i.get("id") for i in task.get("library") or []}
        task["library"] = [*(task.get("library") or []), *[i for i in usable if i.get("task_id") == task["task_id"] and i.get("id") not in have]]
        return build_state(task, await _task_subtitles(task), auto=best.get("stream_id"))

    # Nothing downloaded: a search that is still running (or found something) a moment ago is reused too.
    try:
        recent = await _call("GET", "/v1/tasks", params={**{k: v for k, v in params.items() if k != "limit"}, "limit": 5})
    except HTTPException:
        recent = []
    for summary in recent:
        if summary.get("status") == "expired":
            continue
        try:
            task = await _call("GET", f"/v1/tasks/{summary['task_id']}")
        except HTTPException:
            continue
        if task.get("status") == "running" or best_stream(task):
            if best_stream(task):
                return await request_download(user, task["task_id"], None)
            return build_state(task, [])

    body: dict = {"tmdb_id": tmdb_id, "type": media_type, "starred_first": s.resolver_starred_first}
    if media_type == "tv":
        body.update(season=season, episode=episode)
    # Only the best source(s) at first (RESOLVER_FIRST_SOURCES); the menu can ask for more later.
    if s.resolver_first_sources > 0:
        body["max_sources"] = min(s.resolver_first_sources, 50)
    wait = min(max(s.resolver_first_wait_s, 1), 30)
    task = await _call("POST", "/v1/resolve", params={"wait": "first", "wait_s": wait}, json_body=body, timeout=wait + 15)
    if best_stream(task):
        return await request_download(user, task["task_id"], None)
    return build_state(task, [])


async def library_media(library_id: str | None) -> tuple[str, dict]:
    """A fully downloaded video's id and details, for the server's own use (the subtitle sync takes its audio)."""
    if not library_id:
        raise HTTPException(404, "This video isn't available to sync against.")
    item = await _call("GET", f"/v1/library/{quote(library_id, safe='')}")
    if _item_state(item) != "ready":
        raise HTTPException(409, "Wait until the video has finished downloading, then sync the subtitle.")
    return item["id"], {"id": item.get("id"), "source": item.get("source"), "quality": item.get("quality"), "duration_s": item.get("duration_s")}


async def fetch_audio(library_id: str, dest: "Path", expected_bytes: int | None = None, on_progress=None) -> str | None:
    """Streams ONLY the audio of a downloaded video from the resolver (GET /v1/library/{id}/audio) into `dest`.
    Returns a description of what went wrong, or None. Written to a temp file first, so `dest` is never half-done."""
    s = get_settings()
    tmp = dest.with_suffix(dest.suffix + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{_base()}/v1/library/{quote(library_id, safe='')}/audio"
    got = 0
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=httpx.Timeout(600, connect=8), follow_redirects=False) as c:
            async with c.stream("GET", url, params={"format": s.resolver_audio_format, "track": 0}, headers={"x-api-key": s.resolver_api_key}) as r:
                if r.status_code >= 400:
                    body = (await r.aread())[:300].decode(errors="replace")
                    tmp.unlink(missing_ok=True)
                    return f"The resolver's audio endpoint answered {r.status_code}: {body}".strip()
                with tmp.open("wb") as f:
                    async for chunk in r.aiter_bytes(64 * 1024):
                        f.write(chunk)
                        got += len(chunk)
                        if on_progress and expected_bytes:
                            await on_progress(min(got / expected_bytes, 1.0))
    except httpx.HTTPError as e:
        tmp.unlink(missing_ok=True)
        return f"Couldn't reach the resolver's audio endpoint: {type(e).__name__} {e}"[:600]
    if got < 1000:
        tmp.unlink(missing_ok=True)
        return f"The resolver's audio endpoint sent almost nothing ({got} bytes)."
    os.replace(tmp, dest)
    return None


async def fetch_text(url: str) -> str:
    """A small text file (a subtitle) from the resolver's own host."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in _allowed_hosts():
        raise HTTPException(400, "That link can't be fetched.")
    async with _client(30) as c:
        r = await c.get(url)
    if r.status_code != 200:
        raise HTTPException(502, UNAVAILABLE)
    return r.text


# ---------------------------------------------------------------- relay (proxy mode)

def _allowed_hosts() -> set[str]:
    s = get_settings()
    hosts = {urlparse(s.resolver_url).hostname or ""}
    hosts |= {h.strip().lower() for h in s.resolver_extra_hosts.split(",") if h.strip()}
    return {h for h in hosts if h}


def _relay_ref(ref: str, base: str) -> str:
    absolute = urljoin(base, ref)
    pu, pb = urlparse(absolute), urlparse(base)
    if not pu.query and pb.query:  # signed playlists often sign their segments with the same query
        absolute = f"{absolute}?{pb.query}"
    return f"relay?u={quote(absolute, safe='')}"


def rewrite_playlist(text: str, base: str) -> str:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            out.append(line)
        elif s.startswith("#"):
            out.append(_URI_ATTR.sub(lambda m: f'URI="{_relay_ref(m.group(1), base)}"', line))
        else:
            out.append(_relay_ref(s, base))
    return "\n".join(out) + "\n"


async def relay(url: str, range_header: str | None) -> Response:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in _allowed_hosts():
        raise HTTPException(400, "That link can't be relayed.")
    headers = {"Range": range_header} if range_header else {}
    client = _client(60)
    try:
        current = url
        for _ in range(4):  # follow a few redirects, re-checking the host each time
            req = client.build_request("GET", current, headers=headers)
            resp = await client.send(req, stream=True)
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                current = urljoin(current, resp.headers["location"])
                await resp.aclose()
                if (urlparse(current).hostname or "").lower() not in _allowed_hosts():
                    raise HTTPException(400, "That link can't be relayed.")
                continue
            break
    except HTTPException:
        await client.aclose()
        raise
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(502, UNAVAILABLE)

    ctype = resp.headers.get("content-type", "")
    if resp.status_code >= 400:
        await resp.aclose()
        await client.aclose()
        raise HTTPException(resp.status_code if resp.status_code in (401, 403, 404, 416) else 502, "The video isn't available.")
    if "mpegurl" in ctype.lower() or urlparse(current).path.endswith(".m3u8"):
        raw = await resp.aread()
        await resp.aclose()
        await client.aclose()
        text = raw.decode("utf-8", errors="replace")
        return Response(
            rewrite_playlist(text, current),
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store"},
        )
    keep = {k: v for k, v in resp.headers.items() if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges", "content-encoding")}

    async def close() -> None:
        await resp.aclose()
        await client.aclose()

    return StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, headers=keep, background=BackgroundTask(close))
