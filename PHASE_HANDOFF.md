# CandyFlix — Project Handoff

**Read this first, in full, before touching any code.** This document is written for a fresh Claude session that has this document plus a zip of the current codebase, and nothing else. It assumes zero memory of prior conversations.

---

## 1. Project Overview

**CandyFlix** is a small, private, self-hosted movie & TV streaming app — built for one person (Candy) and a handful of people close to her. It is explicitly **not** a public product: no signup flow, no generic "streaming platform" chrome, no scale concerns. It's a personal project built collaboratively between the user and Claude across many sessions, used both as a real app and as a vehicle for the user to learn full-stack development by directing an AI coding assistant.

Design philosophy stated repeatedly by the user and honored throughout: keep things **simple, lean, and correct** rather than over-engineered. Don't build abstractions speculatively ahead of a second real need (see the `providers/` discussion in §6). Prefer graceful degradation over hard failures wherever a feature is "nice to have" (subtitles, watchlist enrichment) rather than core (playback itself).

The app uses TMDB (The Movie Database) for all movie/TV metadata (posters, overviews, cast-free basic info, trending/popular lists, season/episode data) and currently plays back **local mock video files only** — there is no real/licensed video source wired up yet, and building one is explicitly deferred (see Roadmap and Constraints below).

### Who it's for
- The end users: Candy and her family/friends, each with their own login (invite-only, provisioned via a CLI — no public signup).
- The "reader" of this document: a future Claude session picking up development. Treat the person as the same collaborator from prior sessions — informal, hands-on, gives quick feedback and course-corrections, generally trusts Claude's engineering judgment but has specific, sometimes strong opinions about UX details (documented throughout this doc).

---

## 2. Goals & Success Criteria

There is no formal PRD. The working goals, as they've emerged:

1. **A working personal Netflix-alternative**: browse trending/popular movies & TV, search, view details, watch (currently mock video), track progress, save a watchlist.
2. **A genuinely pleasant player experience** — this has received by far the most iteration. Success criteria expressed by the user: looks and feels like a polished commercial product (YouTube was the explicit visual reference for the control bar), works correctly on both desktop and mobile (including phone-fullscreen — a real, previously-broken case), and "just works" without the person needing to think about it (auto-resume, remembered preferences, automatic subtitle discovery).
3. **Correctness over cleverness in the backend** — every bug the user has reported has been treated as a real bug to find and fix at the root cause, not papered over. Multiple times in this project, an apparent "one bug" turned out to be two independent bugs (see §7), and both were found and fixed rather than settling for a partial fix.
4. **A codebase a future session (or the user, eventually) can actually maintain** — hence the heavy commenting style (see §8) and this very document.

There's no automated "done" signal; progress is phase-by-phase (see §4), each phase ending when the user says so.

---

## 3. Architecture

### 3.1 Tech stack

- **Backend:** FastAPI (async), SQLAlchemy 2.0 (async ORM), PostgreSQL, Redis, Alembic for migrations. Python 3.12.
- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS. Server Components by default; `"use client"` only where real interactivity is needed.
- **Infra:** Docker Compose for local dev (`db`, `redis`, `backend`, `frontend` services). The backend container runs migrations automatically on startup (`entrypoint.sh`).
- **External APIs:** TMDB (metadata — required), OpenSubtitles REST API v1 (subtitle discovery — required for that feature only, has its own API key).

### 3.2 High-level design

```
Browser
  │
  ├─ Next.js frontend (SSR pages + client components)
  │     │
  │     ├─ Server Components fetch via lib/*-server.ts (forwards cookies
  │     │  explicitly — a Node-side fetch has no browser cookie jar)
  │     └─ Client Components fetch via lib/*.ts (credentials: "include")
  │
  └─ FastAPI backend (all routes under /api)
        │
        ├─ api/routes/*.py      — thin HTTP layer, auth via get_current_user dep
        ├─ services/*.py        — business logic, external API calls, caching
        ├─ models/*.py          — SQLAlchemy ORM models
        ├─ schemas/*.py         — Pydantic request/response shapes (kept
        │                         separate from ORM models on purpose)
        ├─ providers/           — playback source(s); currently just
        │                         mock_provider.py (local test video file)
        │
        ├─→ PostgreSQL           — users, watch_progress, watchlist_items
        ├─→ Redis                — TMDB response cache + OpenSubtitles
        │                          login-token cache
        ├─→ TMDB API             — all movie/TV metadata (cached in Redis:
        │                          15 min for trending/search, 6h for details)
        └─→ OpenSubtitles API    — subtitle search/download (Phase 5b)
```

### 3.3 Key architectural decisions and why

- **DB stores identity, not display data.** `WatchProgress` and `WatchlistItem` both store only `(user_id, tmdb_id, media_type, ...)` — never a cached title/poster/overview. Anything display-related is fetched fresh from TMDB at read time. Rationale: a renamed or since-deleted TMDB title just reflects reality next time it's loaded, instead of the DB quietly going stale. Cost: list endpoints for these do N TMDB fetches (mitigated by Redis caching + `asyncio.gather` for concurrency), and any one unresolvable item is silently skipped rather than 500ing the whole list — this pattern is used in the watchlist route and should be followed for any future feature with the same shape.
- **No real third-party playback providers, ever — product decision, not a technical limitation.** `mock_provider.py` scans a local folder for one test video file. This is intentional and is expected to remain true even when other "real" integrations exist (OpenSubtitles is real and fine — it's a metadata/subtitle lookup, not a video source). The eventual real playback path is a **self-hosted "Candy Server"** (unbuilt, out of scope for now) for content the household has legitimate rights to. Do not build a real external-link scraper/provider even if asked to "just make playback work" — flag this constraint if it comes up.
- **No provider abstraction layer was built**, despite once being planned (`base.py` PlaybackSource ABC, `ProviderRegistry`, `examples/` — see old `providers/README.md`, now corrected). With only one provider ever implemented, the abstraction had no second real caller to justify its shape, so it was skipped. **If a second provider is ever actually built (Candy Server), design the abstraction then, informed by what that second provider actually needs — not speculatively now.**
- **Session auth, not JWT.** Opaque random token (`secrets.token_urlsafe(32)`) in a `HttpOnly`, `SameSite=Lax` cookie (`candyflix_session`), keyed to a server-side session record. 30-day TTL — deliberately long, since "this is a private app for a handful of trusted people, not a bank" (direct rationale from `security.py`). Password hashing via `pwdlib`'s Argon2 hasher.
- **Invite-only, no public signup.** Users are provisioned via `python -m app.cli create-user <username> "<Display Name>"`, which prompts for the password via `getpass` (never a CLI arg, so it never lands in shell history).
- **Redis caching pattern**: `tmdb_service.py` has a private `_get(path, params, ttl)` helper that all TMDB calls go through, caching the raw JSON response by URL+params.
- **Backend error pattern**: each service that talks to an external API defines its own exception class (`TMDBError`, `OpenSubtitlesError`) carrying `(status_code, message)`. Routes catch these and re-raise as `HTTPException(status_code=e.status_code, detail=e.message)`. Follow this pattern for any new external integration.
- **Frontend split: `lib/x.ts` vs `lib/x-server.ts`.** Client Components use `lib/playback.ts`, `lib/watchlist.ts`, etc. (browser `fetch` with `credentials: "include"`). Server Components (pages doing SSR data fetching) use the `-server.ts` counterpart, which reads `next/headers` `cookies()` and forwards them explicitly as a `Cookie` header — a Node-side `fetch()` has no access to the browser's cookie jar, so `credentials: "include"` silently does nothing there. **This is a real, easy-to-miss bug class — if you add a new authenticated endpoint that a Server Component needs to call, you need the `-server.ts` version, not the client one.**
- **Player preferences: two different storage lifetimes, chosen deliberately.**
  - `localStorage` (`player-preferences.ts`) for volume/mute/subtitle-language — genuinely durable, should survive closing the browser entirely.
  - `sessionStorage` for the sleep timer's absolute end-timestamp — deliberately *not* durable across browser-close (a sleep timer that silently resumed counting down after you closed the tab yesterday would be a bug, not a feature), but *is* durable across a same-tab page navigation (see §4, Phase 5c — this is what lets it survive clicking "next episode").
- **Design system**: dark theme only. Colors (CSS vars in `globals.css`): background `#0b0b12`, primary accent (raspberry/pink) `#FF5FA2`, secondary accents lilac `#c9a6ff` and mint `#8fe3c7`. Fonts: **Fraunces** (serif, display/headings — "premium fantasy world" feeling) via `--font-display`, **Inter** (body/UI) via `--font-body`. The player's control bar was redesigned to closely match YouTube's actual control bar layout/proportions (per a real reference the user provided), re-skinned in the CandyFlix palette.

### 3.4 Data flow example: playing an episode

1. User navigates to `/watch/tv/{id}/{season}/{episode}` (a Server Component page).
2. Page fetches show/season details from TMDB (via `lib/media.ts`), plus the playback source via `lib/playback-server.ts` → backend `GET /api/playback/tv/{id}/{season}/{episode}`.
3. Backend: `mock_provider.get_mock_video_url()` finds the one file in `mock-videos/`. Separately, `subtitle_service.get_default_english_track()` resolves the title's IMDb ID (via TMDB), searches OpenSubtitles for English, downloads the top (most-downloaded) result, caches it in `subtitle-cache/`, and returns it as the default subtitle track — or returns `None` silently on any failure (missing IMDb id, no results, OpenSubtitles down), since subtitles must never block playback.
4. Page also computes prev/next episode, rolling over into the adjacent season at a season boundary (excluding season 0/Specials) — this needs one extra `getSeason()` call, only at the actual boundary episodes.
5. `<VideoPlayer>` (a large client component) receives the `PlaybackSource`, identity info, and prev/next episode links, and renders the actual player.
6. Player restores remembered volume/mute/subtitle-language from `localStorage` in a post-hydration `useEffect` (see §7 for why not in `useState`'s initializer), restores a running sleep timer from `sessionStorage` if one exists, and restores watch progress from the backend (`WatchProgress` model, autosaved periodically + on pause/seek/tab-hide via `useWatchProgress.ts`).

---

## 4. Current Project Phase & Roadmap

### Phase history (all complete, in order)
1. Project setup
2. Auth (User model, Argon2, sessions, CLI user provisioning)
3. TMDB integration (trending, search, movie/TV/season details)
4. Browsing/search UX and visual polish (grids, hero carousel, backdrop cropping, etc.)
5. **Playback** (subdivided — this is where almost all recent work happened):
   - **5a — mock playback + watch progress**: custom-built video player (not native browser controls) against a local mock video file; `WatchProgress` model with autosave; subtitle rendering (custom overlay, not native `<track>`). Along the way, fixed 5 real player bugs including MP4 "faststart" encoding requirements (see `mock-videos/README.md`) and a browser Range-request caching bug (`NoCacheStaticFiles` in `main.py`).
   - **5b — online subtitle discovery**: integrated the real OpenSubtitles REST API. Auto-fetches a default English subtitle for every playback source; in-player UI to discover/search/browse other languages and specific releases; download caching to avoid burning OpenSubtitles' small daily quota. `mock-subtitles/` local files are fully deprecated/unused as of this phase.
   - **5c — player polish**: remembered volume/mute/subtitle-language preferences across sessions; cross-season episode rollover (both directions); a sleep timer (wall-clock based, survives episode navigation); volume icon reflects level (3 states); numerous positioning/hydration bug fixes (see §7); added the site header/search to the watch pages (a deliberate reversal of an earlier "distraction-free player" decision — the user asked for it back); season/episode picker added below the video on the watch page.
6. **Candy Box (watchlist)** — ✅ just completed. `WatchlistItem` model, add/remove/list/status endpoints, wired into both detail pages and the home page hero carousel, Candy Box page reuses the existing `MediaGrid` component.

### **You are here.** Next: Phase 7.

### Roadmap — what's next, per the user's explicit agreement in an earlier session

- **Phase 7 — Continue Watching** (next up):
  - A home-page row of in-progress titles (the `WatchProgress` model was deliberately designed with this in mind — should mostly be a query + a UI row, not new backend modeling work).
  - Additionally, the user specifically asked for a **separate section for in-progress *series*** showing exactly where they are (e.g. "S2:E8"), where clicking "Watch Now" resumes from that exact episode/timestamp — and the button itself should hint where it'll resume (e.g. "Watch Now — S2:E8") rather than being a plain "Watch Now."
- **Phase 8 — Polish**: general loading/error states, mobile refinement, animations, empty states. Not player-specific this time (the player already got its polish phase).
- **Longer-term / explicitly deferred, not scheduled**: real playback sources (a self-hosted "Candy Server" media pipeline, or conceivably a legitimate external-link provider), real adaptive-quality streaming (HLS/DASH). Do not start these without the user explicitly asking — they've been deferred multiple times by name.

---

## 5. Codebase Map

```
candyflix/
├── README.md                    Project overview + setup instructions (kept in sync
│                                 with real progress — was stale for a while, fixed
│                                 alongside this handoff doc)
├── docker-compose.yml            db (postgres:16-alpine), redis (redis:7-alpine),
│                                  backend, frontend
├── .gitignore
│
├── backend/
│   ├── app/
│   │   ├── main.py                FastAPI app: static mounts, router registration,
│   │   │                          the NoCacheStaticFiles class (real bug fix, see §7)
│   │   ├── cli.py                 User provisioning CLI (create-user, list-users)
│   │   ├── core/
│   │   │   ├── config.py          Settings (env vars) — TMDB key, OpenSubtitles
│   │   │   │                      creds, session secret, mock-video dir, etc.
│   │   │   ├── db.py               Async SQLAlchemy engine/session, Base
│   │   │   ├── redis.py            Redis client singleton
│   │   │   ├── security.py         Password hashing, session cookie config
│   │   │   └── language_labels.py  ISO 639 code → human name (pycountry-backed;
│   │   │                          see §7 for why it's not a hand-typed dict)
│   │   ├── models/                 SQLAlchemy ORM: user.py, watch_progress.py,
│   │   │                          watchlist_item.py
│   │   ├── schemas/                Pydantic I/O shapes: auth.py, media.py,
│   │   │                          playback.py, subtitles.py, watchlist.py
│   │   ├── services/                Business logic layer:
│   │   │   ├── auth_service.py
│   │   │   ├── tmdb_service.py     All TMDB calls + Redis caching (the `_get` helper)
│   │   │   ├── opensubtitles_service.py   Search/download/login against the real
│   │   │   │                      OpenSubtitles API — read this file's module
│   │   │   │                      docstring, it documents several real bugs fixed
│   │   │   ├── subtitle_service.py Orchestrates "get the default English subtitle
│   │   │   │                      for this playback source" with graceful failure
│   │   │   ├── watch_progress_service.py
│   │   │   └── watchlist_service.py
│   │   ├── providers/
│   │   │   ├── mock_provider.py    The only playback provider — see §3.3
│   │   │   └── README.md           Recently corrected — read this before assuming
│   │   │                          any provider abstraction exists
│   │   └── api/
│   │       ├── deps.py              get_current_user dependency
│   │       └── routes/              auth, health, movies, tv, search, trending,
│   │                                playback, subtitles, watchlist
│   ├── alembic/
│   │   ├── env.py                   ⚠️ Models must be imported here explicitly
│   │   │                          (`from app.models import x  # noqa`) for
│   │   │                          autogenerate to see them — models/__init__.py
│   │   │                          alone is NOT enough (it only re-exports User;
│   │   │                          this inconsistency is pre-existing, not a bug
│   │   │                          worth fixing unless you're already in there)
│   │   └── versions/                 3 migrations so far: users, watch_progress,
│   │                                watchlist_items
│   ├── mock-videos/README.md         Drop one test video here; documents the
│   │                                ffmpeg faststart fix (see §7)
│   ├── mock-subtitles/README.md      Deprecated notice — this folder does nothing
│   │                                as of Phase 5b
│   ├── tests/                        pytest + respx (mocks TMDB/OpenSubtitles HTTP
│   │                                calls) — but Postgres and Redis are REAL, not
│   │                                mocked (see §8 for how to spin them up)
│   ├── requirements.txt
│   └── .env.example                  Copy to .env; documents every required var
│
└── frontend/
    ├── app/
    │   ├── layout.tsx                 Root layout, fonts
    │   ├── login/page.tsx
    │   ├── (main)/                    Route group: has Nav (header+search) + auth
    │   │   ├── layout.tsx
    │   │   ├── page.tsx                Home: hero carousel + trending/popular rows
    │   │   ├── movie/[id]/page.tsx
    │   │   ├── tv/[id]/page.tsx
    │   │   ├── movies/, series/, search/
    │   │   └── candy-box/page.tsx      Watchlist page (reuses MediaGrid)
    │   └── watch/                      Route group: ALSO has Nav now (see §4, 5c)
    │       ├── layout.tsx
    │       ├── movie/[id]/page.tsx
    │       └── tv/[id]/[season]/[episode]/page.tsx   Cross-season rollover logic
    │                                    lives here
    ├── components/
    │   ├── Nav.tsx / NavSearch.tsx      Site header + search
    │   ├── MediaGrid.tsx / MediaCard.tsx  Generic title-grid rendering, reused
    │   │                                everywhere (home rows, search, Candy Box)
    │   ├── HeroCarousel.tsx
    │   ├── DetailActions.tsx            "Watch Now" + "Add to Candy Box" buttons —
    │   │                                now a client component (Phase 6)
    │   ├── SeasonBrowser.tsx            Episode picker; reused on BOTH the TV
    │   │                                detail page and (with extra props) the
    │   │                                watch page
    │   ├── MediaBrowser.tsx / SearchPageClient.tsx / AdvancedSearchPanel.tsx
    │   ├── LogoutButton.tsx
    │   └── player/                     ⚠️ This is where most of the recent,
    │       │                          intricate work lives
    │       ├── VideoPlayer.tsx          The big one (~1500+ lines). Custom
    │       │                          controls, subtitle rendering, sleep timer,
    │       │                          settings menu (portal-based, see §7),
    │       │                          scrub bar, everything player-related except
    │       │                          the subtitle *settings panel* itself.
    │       ├── SubtitleOverlay.tsx      Renders the active cue with live styling
    │       ├── SubtitleSettingsPanel.tsx  The subtitle language/styling picker —
    │       │                          dropdown + "search all subtitles" browse UI
    │       ├── subtitle-utils.ts        SRT/VTT parsing (`parseSubtitles`, `Cue`)
    │       ├── subtitle-settings.ts     Persisted subtitle *styling* (font/size/
    │       │                          color/position) — localStorage
    │       ├── player-preferences.ts    Persisted volume/mute/subtitle-*language*
    │       │                          (separate from styling above) — localStorage
    │       └── useWatchProgress.ts      Autosave hook; exports `WatchIdentity` type
    ├── lib/
    │   ├── api-client.ts                getApiBaseUrl / getStaticOrigin
    │   ├── media.ts                     MediaItem/MovieDetail/TVShowDetail types +
    │   │                                fetchers (client-safe, no auth needed)
    │   ├── playback.ts / playback-server.ts    Client vs server-safe fetchers —
    │   │                                see §3.3 for why both exist
    │   ├── watchlist.ts / watchlist-server.ts   Same client/server split
    │   ├── session.ts                   getServerCurrentUser
    │   ├── auth.ts                      login/logout (client)
    │   └── useDebouncedSearch.ts
    └── __tests__/                       Vitest. Some tests need a real backend
                                          running on :8000 (login/logout/media-pages/
                                          nav-search) and will fail without one —
                                          this is expected, not a regression signal
                                          (see §8)
```

---

## 6. Decisions & Constraints

- **No real playback providers, ever (product decision).** Stated explicitly multiple times. Even if a future request sounds like "just make it play real videos," check whether that means (a) improving the mock/local pipeline, which is fine, or (b) scraping/embedding a real external video source, which is out of bounds without an explicit, unambiguous instruction to change this constraint.
- **OpenSubtitles is a real third-party integration and that's fine** — the "no real providers" rule is specifically about the video/playback source, not metadata or subtitle lookups.
- **Invite-only auth is permanent**, not a placeholder — there's no plan to add public signup.
- **Subtitle language preference is global, not per-title.** Deliberate: "remember how I like to watch," not "remember what I did for this specific show" (mirrors most real players).
- **Sleep timer is wall-clock, not playback-time, and persists across episode navigation.** Explicitly reasoned through: the point of a sleep timer while binge-watching is "stop once I've actually fallen asleep," not "stop whenever the current episode happens to end." The user was told this was a design choice and given the option to reverse it (reset per-episode instead) — they did not ask for a change, so keep it as-is unless told otherwise.
- **Season 0 ("Specials") is excluded from cross-season episode rollover**, in both directions. Jumping into specials as if they're "next in sequence" isn't what a viewer expects.
- **The subtitle "browse all uploads" search matches release name, language name, AND language code** (not just release name) — this was a real bug fix (see §7); don't regress it if touching `opensubtitles_service.search()`'s query filter.
- **Watchlist enrichment gracefully skips unresolvable items** rather than 500ing — same pattern should be used for Phase 7's Continue Watching row (a `WatchProgress` row pointing at a title TMDB can no longer resolve should be skipped, not break the row).
- **Trade-off accepted, not a bug**: the home page's hero carousel fires one watchlist-status API check per rendered slide (up to 5) on load, since all slides render at once (just hidden). Deemed acceptable — small per-user queries — rather than adding coordination complexity to batch them.
- **Trade-off accepted, not a bug**: OpenSubtitles' `/subtitles` search is paginated and only page 1 is fetched for the auto-discovered "languages available" dropdown list (a manual "search all subtitles" browse UI with a Load More button covers the rest). A title with an unusually large number of uploads across many languages could theoretically have a language that doesn't show up in the initial auto-discovered list — the manual search covers this gap.
- **A past security concern, possibly still open**: earlier in the project, the user mentioned they'd already pushed `.env` files (with real secrets) to GitHub before a `.gitignore` existed. They were advised to `git rm --cached` those files and **rotate every secret that was in them** (TMDB key, session secret, DB password, OpenSubtitles credentials) since git history retains old commits regardless. **It is not confirmed whether this was actually done.** If continuing this project with real deployment in mind, this is worth confirming/re-raising.

---

## 7. Known Issues / Open Questions

### Resolved bugs worth knowing about (the *pattern*, in case it recurs elsewhere)
These were real, sometimes subtle bugs found and fixed during this project. Listed because the same *class* of bug could easily be reintroduced elsewhere in the codebase if the underlying lesson isn't kept in mind.

1. **MP4 "faststart" encoding.** A browser can't reliably seek/report duration on an MP4 whose `moov` atom is at the end of the file. Fix: `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4` (documented in `mock-videos/README.md`). Relevant again the moment a real video pipeline (Candy Server) exists — that pipeline should run this pass on ingest.
2. **Browser Range-request caching bug.** Every mock "episode" resolves to the literal same physical video file, so many different `Range` requests hit one URL. Without an explicit `Cache-Control: no-store`, the browser's heuristic caching of 206 responses gets confused and can silently replay a stale response — visible as a hung video with **no corresponding request even reaching the backend logs**. Fixed via `NoCacheStaticFiles` in `main.py`. If this ever recurs (hung video, no server-side log line), check this first.
3. **`useState` lazy initializer + `localStorage` = hydration mismatch.** Reading `localStorage` inside a `useState(() => ...)` initializer diverges between the server-rendered HTML (no `localStorage` there) and the client's first hydration pass (real `localStorage` value) — React throws a hydration error and the mismatched attribute doesn't get patched up. **Fix pattern**: always initialize with a fixed, SSR-safe default; apply the real persisted value in a `useEffect` that runs post-hydration. Accept a brief (sub-frame, imperceptible in practice) "flash of default" — this is the same trade-off `next-themes` and similar libraries make.
4. **Blanket "watch state, save on any change" effects are dangerous for persistence.** Such an effect fires once on the very first mount too, using default (pre-restoration) values — potentially overwriting a real saved preference with the default the instant a new page loads, depending on effect-ordering races. **Fix pattern used here**: persist explicitly at the exact point of user action (inside the specific handler function — `changeVolume`, `toggleMute`, a dedicated `selectSubtitleLanguage` wrapper), never via a generic effect watching the value.
5. **A persisted preference can't be restored if restoration only checks "is it already in the baked-in default list."** Non-English subtitle languages were never actually restorable even after fixing bug #4, because the restoration logic only checked `source.subtitles` (which only ever contains the one auto-fetched English default) — it needed to actively re-search OpenSubtitles for the remembered language on the new title, same as a manual search would.
6. **`httpx.AsyncClient` does not follow redirects by default.** OpenSubtitles was observed 301-redirecting some requests; without `follow_redirects=True`, the redirect's own HTML page gets treated as the API response and fails to parse — surfaces as a confusing generic error, not an obvious "redirect" symptom. All OpenSubtitles HTTP clients now set this explicitly.
7. **Fullscreen API "top layer" and portals.** A UI element portaled to `document.body` becomes invisible/unclickable the instant an *descendant* element (not `document.body` itself) enters native fullscreen via `requestFullscreen()` — the Fullscreen API only renders the fullscreened element's own subtree in its special top layer. Fix: detect fullscreen state and portal into the fullscreened container itself when active, `document.body` otherwise.
8. **Popover/dropdown `max-height` must be computed from real available space, not a flat `vh` percentage.** `max-h-[85vh]` assumes the *whole* viewport is available; once something else (the site header) already occupies part of it, a flat percentage can still overflow the actual visible remainder even when the "which direction to open" logic was already correct. Fixed by computing a real pixel max-height from actual measured space in whichever direction gets chosen.
9. **A `position: fixed` element doesn't move with the page during scroll.** Once the watch page could scroll at all (after adding the header), a settings dropdown whose position was computed once at open-time visually "detached" from its trigger button during scroll. Fixed by also recomputing position on a `scroll` listener, not just `resize`.
10. **A hand-typed language-code lookup table doesn't scale.** OpenSubtitles returns the full ISO 639-1 set (~180 languages); a ~19-entry hand-typed dict left most of them showing as raw uppercased codes. Replaced with `pycountry`. Watch out: `pycountry`'s *technically correct* ISO names aren't always what a normal UI should show (Greek came back as "Modern Greek (1453-)"; several languages get a "(macrolanguage)" suffix) — `language_labels.py` has a small override table plus a generic suffix-strip for this.

### Genuinely open / unresolved
- **Root README staleness**: was significantly out of date (still said "Phase 4.3" and didn't mention Phases 5–6 at all) as of the start of this handoff — **just corrected** as part of preparing this document, along with `providers/README.md`. Keep both in sync going forward; they're an easy thing to forget to update mid-phase.
- **`.env` secret-rotation status unconfirmed** — see §6.
- **HeroCarousel's watchlist-status N+1-ish calls** — accepted trade-off, not fixed, see §6.
- **OpenSubtitles page-1-only auto-discovery** — accepted trade-off, not fixed, see §6.
- Sleep timer's "add time" dialog defaults to a fixed +15 minutes (not user-configurable at that moment) — the user didn't ask for more control here, but flagged as an easy thing to expand if it comes up.
- No formal error/loading-state design pass has happened yet anywhere in the app outside the player — that's explicitly what Phase 8 is for.

---

## 8. Conventions

### Backend
- **Service layer pattern**: routes are thin — auth via `Depends(get_current_user)`, call into a `services/*.py` function, translate exceptions to HTTP responses. Business logic and external API calls live in services, never in routes.
- **Schemas separate from ORM models.** Pydantic schemas in `schemas/` are the API's actual contract; SQLAlchemy models in `models/` are internal. Don't return an ORM model directly from a route.
- **Custom exceptions carrying `(status_code, message)`** for each external integration (`TMDBError`, `OpenSubtitlesError`), caught at the route layer. Follow this for any new integration.
- **Migrations are always generated via `alembic revision --autogenerate`**, never hand-written, and always reviewed before applying. Remember to import any new model in `alembic/env.py` (see §5 warning) or autogenerate won't see it.
- **Tests use a real local Postgres + Redis, not mocks** — only external HTTP calls (TMDB, OpenSubtitles) are mocked, via `respx`. To run backend tests in a fresh sandbox/container: install `postgresql` and `redis-server` (both are apt-installable and were not preinstalled in at least one prior session's sandbox), start both services, create a `candyflix`/`candyflix` Postgres role+db, run `alembic upgrade head`, then `pytest`. **Both services have been observed dying between tool calls in ephemeral sandboxes — always verify both are actually up (`redis-cli ping`, `pg_isready`) immediately before running tests, not just once per session.**
- **Graceful degradation for optional/enrichment data**: if a piece of functionality is "nice to have" and depends on an external service (subtitle auto-fetch, watchlist TMDB enrichment), failures are logged and swallowed, never allowed to break the core feature (video playback, the rest of the list).
- Docstrings and comments throughout explain **why**, not just what — often citing the specific bug or user report that led to a piece of logic existing. Continue this; it's what makes this codebase navigable across sessions without shared memory.

### Frontend
- **Server Components by default**; `"use client"` only added when a component genuinely needs interactivity/state/effects.
- **`lib/x.ts` (client) vs `lib/x-server.ts` (server, cookie-forwarding)** — see §3.3. When adding a new authenticated API call that a Server Component page needs, add it to the `-server.ts` file, not just the client one.
- **Tailwind utility classes throughout**, dark theme only, no light-mode support anywhere.
- **Persistence**: `localStorage` for things that should survive closing the browser (player prefs); `sessionStorage` for things that should survive in-tab navigation but not a fresh browser session (sleep timer). Never read either inside a `useState` lazy initializer (see §7, bug #3) — always restore post-hydration in a `useEffect`.
- **Explicit persistence at the point of user action**, not a blanket watch-effect (see §7, bug #4).
- Heavy inline comments explaining the *reasoning* behind non-obvious code, matching the backend's style — especially around anything that was a real bug fix. New code should keep this up.
- Real components are reused aggressively rather than rebuilt: `MediaGrid`/`MediaCard` render every title grid in the app (home rows, search results, Candy Box); `SeasonBrowser` is used on both the TV detail page and (with additional props) the watch page's episode picker; `DetailActions` is shared across both detail pages and the hero carousel.

### General workflow
- The user gives feedback iteratively and specifically (e.g., precise UI complaints like "the Use button should be vertically centered, not top-aligned") — treat each as exact and address it directly, not as a vague hint. They test on real devices (including phones, both fullscreen and not) and report exact reproduction steps and observed URLs/console output when something breaks — read these carefully, they usually pinpoint the real bug precisely (see §7's whole list, most of which came from exact user bug reports).
- The user has approved and enjoyed a fairly high level of engineering rigor: real migrations (not hand-written), real local Postgres/Redis in tests, root-cause fixes over surface patches, transparent trade-off communication ("I did X, here's the trade-off, tell me if you want it different") rather than silently picking one option.
- When a fix touches a genuinely ambiguous product decision (not just a bug), it's been this project's norm to implement a reasonable default AND explicitly flag the assumption/trade-off in the same response, rather than blocking on a question — the user has consistently either confirmed or lightly corrected these, never been upset by a confidently-made reasonable call.

---

## 9. Immediate Next Steps

1. **Read this whole document**, then open the codebase zip and skim: `backend/app/main.py`, `backend/app/services/watch_progress_service.py`, `frontend/components/player/useWatchProgress.ts`, and `frontend/app/(main)/page.tsx` — these four give you the full picture needed for Phase 7 specifically.
2. **Confirm the plan with the user before writing code** (this project's established norm at the start of a new phase): Phase 7 is Continue Watching, specifically:
   - A home-page row of in-progress titles generally.
   - A distinct section for in-progress **series** showing the exact resume point (e.g. "S2:E8"), where "Watch Now" both resumes from that exact episode/timestamp and visually hints where it'll resume (e.g. button text "Watch Now — S2:E8") instead of a plain "Watch Now."
3. **Backend groundwork likely needed**: a query against `WatchProgress` to find "most recent in-progress items per user," probably grouped/deduplicated per show (a series' progress should collapse to its single most recent episode, not list every episode ever partially watched). Decide: new endpoint(s) in a sensible place — either extend `watch_progress_service.py`/add a route, or a small new `continue_watching` module if the query logic gets non-trivial. Follow the "skip unresolvable TMDB items gracefully" pattern from the watchlist route.
4. **Frontend**: likely a new row component (or extend `MediaCard`/create a variant) that can render the "S2:E8" badge and the resume-aware "Watch Now" label — check whether `MediaCard` can be extended with an optional prop rather than forked into a new component, consistent with this project's reuse-aggressively convention.
5. **As always**: run backend tests against a real local Postgres/Redis (verify both are up first) and the frontend's `tsc --noEmit` + Vitest suite before considering any change done. Expect (and don't be alarmed by) the same ~4 pre-existing frontend test files failing without a live backend running (`login`, `logout`, `media-pages`, `nav-search`) — this is normal, not a regression.
