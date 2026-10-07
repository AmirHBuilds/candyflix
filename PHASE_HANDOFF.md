# CandyFlix — Project Handoff (through Phase 7 + 7 follow-up updates; Phase 8 in progress; Phase 9a built)

> **Reader:** a fresh instance of Claude with **no memory** of the prior conversations, plus a zip of the current codebase.
> **Purpose:** give you everything needed to continue without re-deriving decisions.
> **Fidelity note:** Phases 2–6 are summarised at lower fidelity than Phase 7 because they come from an earlier handoff that is no longer in view. Anything marked **(verify)** should be checked against the code. Phase 7 and everything after it is documented in detail and was verified by running tests.

---

## 0. First things to do in the new chat

1. Read this whole document.
2. Unzip the codebase (it contains a top-level `candyflix/` folder with `backend/` and `frontend/`).
3. Set up the sandbox and run the baseline tests (§9.1 has the exact commands). Expected baseline:
   - Backend: **118 passed**.
   - Frontend: `tsc --noEmit` clean; Vitest **116 passed / 21 failed**, where the 21 failures are the four known files that need a live backend (§7.1).
4. Report back a short summary (where the project stands, what phase, what you understand next steps to be) and flag any discrepancy between this document and the code. The user's established norm is **confirm understanding before writing code**.
5. **The user's 7 pending updates are written out in §10** (their wording plus notes on the code involved). Nothing in §10 has been implemented. That is the actual next work. Several items contain ambiguities; the notes say which assumption to state to the user before building.

---

## 1. Project Overview

**CandyFlix** is a self-hosted, Netflix-style streaming web app: browse and search movies and TV (metadata from TMDB), watch in a custom-built video player with subtitles, keep a personal watchlist ("Candy Box"), and resume where you left off ("Continue Watching").

- **Audience:** a small, trusted group of users (personal/home project). Not a public service. Multi-user with per-user accounts and per-user progress.
- **Product feel:** a polished, commercial-quality streaming UI (dark theme, pink/mint accents), pleasant and low-friction.
- **Playback:** currently serves a **mock video file** for every title and episode (docker logs show every playback request hitting `/mock-videos/...mp4`). No real streaming provider is wired up (see §6, "no provider abstraction").
- **How the user runs it:** `docker compose` (services named `candyflix-backend`, `candyflix-frontend`, `candyflix-db`, plus Redis). Frontend at `http://localhost:3000`, backend on `:8000`. The user tests changes manually in the browser and pastes docker logs when something looks wrong.

## 2. Goals & Success Criteria

**Product goals**
- Browsing, search, and detail pages feel fast and clean.
- A real, custom video player (Phase 5) with remembered preferences and online subtitle discovery.
- Progress tracking that is **trustworthy and predictable**: the app always remembers where you are and never shows confusing or stale state. Most of the recent work was about this.
- Continue Watching and TV resume behavior consistent between the home page, detail page, and player.

**How we know it's working (concrete behaviours the user has verified/expects)**
- Clicking any TV episode, even for one second, makes it "last watched" next time. **There is no minimum watch time** (the user explicitly rejected a 10-second rule).
- Watch Now on a TV detail page resumes the furthest episode reached; the home page's Continue Watching shows the *same* episode.
- "In progress" appears only on an earlier episode you went **back** to after reaching your furthest one, never on the one you simply moved on from, and never on the resume episode itself.
- Switching episodes is instant (no waiting on a network round trip).
- Tests: every bug fixed gets a regression test; backend and frontend suites stay green (apart from the four known live-backend files).

## 3. Architecture

### 3.1 Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js **App Router** (recent version: `params`/`searchParams` are **Promises**; there is a `proxy.ts`, i.e. Next 16-style), React, TypeScript, Tailwind utility classes, Vitest + Testing Library (jsdom) |
| Backend | FastAPI, SQLAlchemy 2.0 (async, asyncpg), Alembic, Pydantic v2, pwdlib (Argon2) |
| Data | PostgreSQL (source of truth), Redis (sessions + TMDB response cache) |
| External | TMDB (metadata), OpenSubtitles REST (subtitle discovery) |
| Tests | pytest + pytest-asyncio + respx (TMDB mocked) against **real** Postgres and Redis |

### 3.2 System shape

```
Browser ──► Next.js (Server Components render pages; Client Components for interactive bits)
   │              │
   │              └─ server-side fetches to FastAPI (cookies forwarded manually — see §8)
   └─ client-side fetches to FastAPI (credentials: "include")

FastAPI ──► routes (thin) ──► services (logic) ──► Postgres / Redis / TMDB
```

- **Auth:** username/password, Argon2 hashes, server-side sessions in Redis, session token in an HTTP cookie (`SESSION_COOKIE_NAME`). `get_current_user` dependency lives in `backend/app/api/deps.py`.
- **Layering rule:** routes stay thin; business logic lives in `backend/app/services/`.
- **Static mounts** served by FastAPI: `/mock-videos/*` (the mock video) and `/subtitle-cache/*` (downloaded `.srt` files).

### 3.3 Key design decisions and why

1. **The DB stores identity, not display data.** `watch_progress` and `watchlist_items` hold only `(tmdb_id, media_type, season, episode, …)`. Titles/posters/ratings are fetched from TMDB at read time ("enrichment"), so nothing goes stale. If TMDB can't resolve an item (`TMDBError`), the route **logs and skips it** instead of 500ing the whole list. Both `watchlist.py` and `continue_watching.py` follow this pattern.
2. **Sentinel `-1` for season/episode on movies** (`NO_SEASON` / `NO_EPISODE` in `models/watch_progress.py`). A unique constraint over `(user, tmdb_id, media_type, season, episode)` does not work with NULLs, so movies store `-1`. The service layer converts to/from `None`; **nothing outside `watch_progress_service.py` should know the sentinel exists** (use `display_season_episode(row)`).
3. **No provider abstraction layer.** Deliberately not built: no second provider exists, so an abstraction would be speculative. `backend/app/providers/README.md` documents this; `providers/examples/` is an empty leftover directory (harmless).
4. **Client vs. server fetchers.** Server Components have no browser cookie jar, so anything authenticated used from a Server Component needs a `*-server.ts` fetcher that forwards the cookie (`lib/watchlist-server.ts`, `lib/playback-server.ts`, `lib/continue-watching-server.ts`). Client Components use the plain `lib/*.ts` versions with `credentials: "include"`.
5. **Watch-page navigation uses plain `<a href>` (full page loads), not client-side routing.** This is the established app convention. Consequence: every episode switch is a fresh server render, which is why the "resume hint" mechanism below exists.
6. **The "furthest episode" (high-water mark) model for TV.** "Where you are" in a show = the row with the greatest `(season_number, episode_number)`, **not** the most recently touched row. See §6.

### 3.4 Progress-tracking design (the heart of recent work)

Read this section carefully; it is where nearly all subtle bugs were.

**Data:** table `watch_progress`, unique constraint `uq_watch_progress_identity`. One row per user per movie / per episode. Fields: `position_seconds`, `duration_seconds`, `updated_at`.

**Write paths (all upsert; all bump `updated_at`):**
- `save_progress` — real playback position (POST `/api/watch-progress`).
- `mark_episode_visited` — TV only; POST `/api/watch-progress/tv/visit` (204). Inserts position 0 / duration 0 if no row exists; if a row exists it **only bumps `updated_at`** (never clobbers real progress). Called from the player hook on mount so a click closed within a second still registers.

**Read semantics (one definition of "where you are", used everywhere):**
- `get_latest_progress_for_title` → the row with greatest `(season, episode)`; **no minimum progress, no near-complete filtering**. Backs Watch Now and the resume highlight (GET `/api/watch-progress/tv/{id}/latest`).
- `list_continue_watching` → one row per title = that title's furthest row; titles ordered by most recent activity (`max(updated_at)` across the title's rows); dropped if the furthest row is finished (`position/duration ≥ 0.95`). A row with `duration ≤ 0` (a bare visit) is kept because it can't be "finished".
- `list_progress_for_season` → all rows for one season (GET `/api/watch-progress/tv/{id}/season-progress?season_number=N`).

**UI vocabulary (TV episode lists, `SeasonBrowser.tsx`):**
- **Resume point / "last watched"** = the furthest episode. Detail page: pink episode name. Player page: mint name + "Last watched" label, **only shown when it is ahead of what's playing** (a resume point *behind* what you just clicked is stale, so it's hidden).
- **"Now playing"** (player page only) = the episode loaded in the player, pink + label.
- **"In progress"** (detail page only; the player page never shows it) = at most **one** other episode, and only if **all** of: it's behind the resume point; it was touched **after** the resume episode's `updated_at` (i.e. you went *back* to it); it has `duration > 0`; it's unfinished (`< 0.95`); it's the most recently touched such episode. Consequences: moving forward 8→9 does **not** mark 8; going back to 2 marks 2; opening 1 next moves the label to 1; touching the resume episode again clears it.

**The navigation-race solution (important, hard-won):**
Clicking an episode navigates immediately, so the next page's server-side "what's my latest?" read races the previous page's save. We tried and rejected an *await-the-save-then-navigate* approach (`flushWatchProgressAndNavigate`, still exported but unused) because it freezes the UI for as long as the network takes. The final design:
1. `navigateWithResumeHint()` fires the save in the background (`fetch` with `keepalive: true`, so it survives the navigation) and navigates **immediately**.
2. It appends a **one-shot hint** to the destination URL: `?fromSeason=S&fromEpisode=E` = "this is the episode I was just on" (TV only).
3. The destination TV pages (detail + watch) read the hint server-side via `parseResumeHintFromSearchParams` and combine it with the server value via `mergeResumeWithHint` (**whichever is further along wins; the hint can only move things forward, never back**, so a stale hint in the URL is harmless once the server catches up).
4. The detail page also passes the hint to `SeasonBrowser` as `recentVisit`, so "In progress" doesn't wait on the save either.
5. `StripResumeHintFromUrl` (tiny client component) removes the params from the address bar after render (cosmetic).

## 4. Current Project Phase & Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Project scaffolding, docker-compose, DB/Redis wiring **(verify)** | Done |
| 2–4 | Auth; TMDB integration; browsing/search UX; visual polish | Done |
| 5a | Real custom video player (custom controls, not native) | Done |
| 5b | Online subtitle discovery via OpenSubtitles REST (older OpenSubtitles client approach deprecated/unused) | Done |
| 5c | Player polish: remembered volume/mute/subtitle language, subtitle settings, etc. | Done |
| 6 | Watchlist ("Candy Box"): add/remove/list, enriched from TMDB | Done |
| **7** | **Continue Watching + TV resume/progress UX** | **Done** (user confirmed it works: *"no that's work thanks!"*) |
| 7+ | The user's **7 follow-up updates** (§10): subtitle offset stepper, player-page search, small-screen search, detail-page button layout/sizing, hero Watch Now | **Done — user confirmed working** (see §12) |

### What Phase 7 delivered (all shipped and tested)

**Continue Watching**
- Single unified home-page row (movies + series), max 24, sorted by recent activity, with a "View All" link (only when `has_more`) to `/continue-watching` (up to 200).
- Every tile links straight to its resume point (`/watch/movie/{id}` or `/watch/tv/{id}/{season}/{episode}`); series tiles get an `S1:E8` poster badge. (An earlier two-row design with a pink "Watch Now — S1:E3" line was removed at the user's request.)
- API: `GET /api/continue-watching?limit=24` → `{items, has_more}` (overfetches `limit+1` for `has_more`).

**TV detail page**
- Watch Now is never disabled for TV: resumes the furthest episode (with an `S1:E8` pill inside the button) or starts at `S1:E1`.
- Episode list styling per §3.4.

**Player page**
- Full-width search bar replaced by a compact search **icon** in the header at all breakpoints (expands in place; closes on outside click / ✕). Other pages keep the full-width row.
- Prev/next/"Up next" controls and the episode list navigate instantly via `navigateWithResumeHint`.

**Bugs found and fixed (each has a regression test):**
1. `save_progress` upsert never bumped `updated_at` (the model's `onupdate=` only fires for ORM-issued updates, not for a raw `on_conflict_do_update`). Everything "most recent"-based looked frozen.
2. Route ambiguity: a path like `/watch-progress/tv/{id}/season/{n}` collides with `/watch-progress/tv/{id}/{season}/{episode}` (Starlette matches structurally; type hints only validate afterwards). Season is a **query param** instead.
3. `keepalive: true` added to `saveWatchProgress` so quick navigation can't cancel a save.
4. Stale "Last watched" after jumping forward (resume point behind what's playing is now hidden).
5. Home page Continue Watching disagreed with the detail page (was "most recent", now "furthest").
6. 10-second minimum rule introduced then **removed** at the user's request (any click counts).
7. "In progress" incorrectly marked the episode you'd just advanced past (now requires "touched after the resume point").

## 5. Codebase Map

Zip layout: `candyflix/` → `backend/`, `frontend/`, `docker-compose*`, `README.md`. **(Exact file list: verify; this is what was observed.)**

### Backend — `backend/app/`
- `main.py` — app factory; includes all routers under `/api`; mounts `/mock-videos` and `/subtitle-cache`; docstring records each phase.
- `api/deps.py` — `get_current_user`.
- `api/routes/` — `auth`, `health`, `movies`, `tv`, `trending`, `search`, `subtitles`, `playback` (playback sources **and** all watch-progress endpoints), `watchlist`, `continue_watching`. Routes are thin.
- `services/` — `tmdb_service` (TMDB + Redis cache, `TMDBError`), `auth_service`, **`watch_progress_service`** (core progress logic, see §3.4), watchlist service.
- `models/` — `user`, `watch_progress` (with `NO_SEASON`/`NO_EPISODE`, unique constraint), watchlist item.
- `schemas/` — `media` (incl. `PagedMediaResponse`: `items` + `has_more`), `playback` (`WatchProgressIn/Out`, `EpisodeVisitIn`; `WatchProgressOut` includes `updated_at`), `watchlist`, `continue_watching` (`ContinueWatchingItemOut`, `ContinueWatchingListOut`).
- `core/` — DB engine/session, Redis client, security/session cookie name, settings.
- `providers/` — `README.md` explaining the deliberate non-abstraction; empty `examples/`.
- `alembic/versions/` — exactly **3** migrations: users, watch_progress, watchlist_items. **No migration was added in Phase 7** (no schema changes).
- `tests/` — `test_playback_routes.py`, `test_continue_watching_routes.py`, `test_watchlist_routes.py`, TMDB service tests, auth tests, etc.

### Frontend — `frontend/`
- `proxy.ts` — Next 16-style request proxy (auth gating) **(verify contents)**.
- `app/layout.tsx`; `app/(main)/layout.tsx`.
- `app/(main)/`: `page.tsx` (home: hero + Continue Watching + Trending/Popular; exports `Section`, `GridItem`, `seasonEpisodeLabel`, `resumeHref`, `toContinueWatchingItems`), `movies/`, `series/`, `search/`, `movie/[id]/`, `tv/[id]/` (detail; reads `searchParams` hint), `candy-box/`, `continue-watching/` (View All).
- `app/watch/layout.tsx` (includes `<Nav />`), `app/watch/movie/[id]/page.tsx`, `app/watch/tv/[id]/[season]/[episode]/page.tsx` (reads hint, merges resume point, renders `VideoPlayer` + `SeasonBrowser`).
- `components/`: `Nav.tsx` (contains `PlayerHeaderSearch`), `NavSearch.tsx`, `MediaCard.tsx` / `MediaGrid.tsx` (optional per-item `href` + `badge`), `HeroCarousel.tsx`, `DetailActions.tsx` (Watch Now + Candy Box), **`SeasonBrowser.tsx`** (episode list + all highlighting rules), `LogoutButton.tsx`.
- `components/player/`: **`VideoPlayer.tsx`** (large; controls, subtitles, Up-next), **`useWatchProgress.ts`** (all save triggers + visit-on-mount), `BackToDetailsLink.tsx`, `StripResumeHintFromUrl.tsx`, `SubtitleOverlay.tsx`, `SubtitleSettingsPanel.tsx`, `player-preferences.ts`, `subtitle-settings.ts`, `subtitle-utils.ts`.
- `lib/`: `api-client.ts` (`getApiBaseUrl`), `auth.ts`, `media.ts` (types + TMDB-backed fetchers + image URL helpers), `watchlist.ts` / `watchlist-server.ts`, **`playback.ts`** (client fetchers + `navigateWithResumeHint`, `mergeResumeWithHint`, `parseResumeHintFromSearchParams`, `recordEpisodeVisit`, save functions), `playback-server.ts`, `continue-watching-server.ts`, `useDebouncedSearch.ts`.
- `__tests__/` — see §7.

### Where to look for…
| Question | File |
|---|---|
| What is "furthest episode / in progress" logic? | `watch_progress_service.py` + `SeasonBrowser.tsx` |
| Why does a URL have `?fromSeason=`? | `lib/playback.ts` (`navigateWithResumeHint`) |
| When does the player save? | `components/player/useWatchProgress.ts` |
| How does the home Continue Watching row get built? | `app/(main)/page.tsx`, `lib/continue-watching-server.ts`, `routes/continue_watching.py` |
| Subtitle offset (timing) setting? | `components/player/SubtitleSettingsPanel.tsx`, `subtitle-settings.ts`, `subtitle-utils.ts`, `SubtitleOverlay.tsx`, `player-preferences.ts` **(verify which file clamps it)** |
| Header search (normal vs. player icon)? | `components/Nav.tsx` (`PlayerHeaderSearch` + the full-width row), `components/NavSearch.tsx` |
| Watch Now / Add to Candy Box buttons? | `components/DetailActions.tsx`; page layouts in `app/(main)/tv/[id]/page.tsx` and `movie/[id]/page.tsx` |
| Home hero banner? | `components/HeroCarousel.tsx` **(verify)** |

## 6. Decisions & Constraints

**Product decisions made (with the user's reasoning)**
- **No minimum watch time.** Clicking an episode counts immediately. Rationale from the user: someone who clicks the newest episode and closes it within a second must find that episode as "last watched" next time, or it looks like the click was ignored. *Trade-off accepted:* an accidental click on a later episode permanently becomes "last watched" until surpassed by a further episode.
- **"Last watched" is the furthest episode, not the most recently touched.** Rewatching or peeking at an earlier episode must not move your resume point.
- **"In progress" has a narrow meaning** (§3.4): an earlier episode you went back to. It is not "any unfinished episode".
- **Player page shows only "Now playing" (+ "Last watched" if the resume point is ahead).** No "In progress" there.
- **Single Continue Watching row**, not separate movie/series sections; overlap is not a concern.
- **Instant navigation over guaranteed-landed saves.** A slow network must never freeze the UI. Durability comes from `keepalive`; correctness on the next page comes from the URL hint.
- **Watch Now for TV is always enabled** (resume, else `S1:E1`).
- Search is a full-width row everywhere except the player, where it's an icon.

**Technical constraints / gotchas**
- **Postgres-only features are fine** (`DISTINCT ON` is used); portability is not a goal.
- `NEAR_COMPLETE_FRACTION = 0.95` exists in **two places** and must stay in sync: `watch_progress_service.py` (backend) and `SeasonBrowser.tsx` (frontend).
- Continue Watching hides a title when its **furthest** row is finished. There is no "next episode" logic, so a finished E8 cannot offer E9.
- `has_more` is computed from the raw DB overfetch, before TMDB enrichment drops unresolvable rows (an accepted approximation).
- Season number is a **query param** on `season-progress` for the route-collision reason above. Don't "clean this up" into a path segment.
- Copyright/attribution: not applicable (private app).

## 7. Known Issues / Open Questions

### 7.1 Tests that fail in a sandbox (expected, not regressions)
Four frontend test files need a **live backend on :8000 and network access to TMDB**: `login.test.tsx`, `logout.test.tsx`, `media-pages.test.tsx`, `nav-search.test.tsx` (21 tests total). Everything else passes.
Cosmetic `act()` warnings appear in `detail-actions` / `nav` tests (from the unrelated Candy Box status fetch); they don't fail anything.

### 7.2 Open items
1. **`media-pages.test.tsx` has a suspicious pre-existing assertion:** that the *movie* detail page's "Watch Now" is a **disabled button**. Movie pages always pass a `watchHref`, so it renders as an enabled *link*. Never verified (can't run it without live TMDB). Worth checking against a real backend.
2. **"Returning to the latest episode clears 'In progress'"** is my inferred behaviour, not something the user specified. Confirm if it comes up.
3. **Movies have no visit-recording endpoint** (TV only). With no minimum, a movie whose playback started (the player saves immediately on `play`) creates a Continue Watching entry; a movie opened but never played does not.
4. **The user's original test show (TMDB id `312949`) has stray old rows** (episodes 9 and 10 saved at position 0 during early testing). Under "any click counts" those legitimately count as visited. Cleanup SQL, if the user wants it:
   ```sql
   SELECT season_number, episode_number, position_seconds, updated_at
   FROM watch_progress WHERE tmdb_id = 312949 ORDER BY season_number, episode_number;
   DELETE FROM watch_progress
   WHERE tmdb_id = 312949 AND season_number = 1 AND episode_number = 10;
   ```
5. **The resume hint is unauthenticated URL data** (`?fromEpisode=99` can spoof one's *own* resume display). Low severity; corrected on the next hint-free load. No write happens from the hint.
6. If a background save fails outright, the UI still looks right for that navigation, but the next hint-free visit falls back to the server's last known state.
7. `flushWatchProgressAndNavigate` in `lib/playback.ts` is exported but unused (kept deliberately for a hypothetical "guaranteed landed" need); safe to delete if it bothers anyone.
8. Nav has no link to `/continue-watching` (reached via "View All" only); not requested.
9. Backend logs SQLAlchemy statements at INFO (very noisy in docker logs). Probably `echo=True` in dev config **(verify)**; not touched.
10. `README.md` phase status likely still says Phase 7 is in progress; should say complete.
11. **(verify)** Leaving the player via *client-side* routing (the header `<Link>`s, or a `NavSearch` result, which uses `router.push`) does not unload the page, so the `pagehide` beacon never fires. The 10s autosave, pause/seek saves, the on-play save and the on-mount visit still cover almost everything, but the last few seconds of position could be lost. Check whether `useWatchProgress` saves on unmount; low severity. Relevant to §10 updates 2–3, since search results will be used from the player.

## 8. Conventions

**Code & structure**
- Routes thin, logic in services; schemas in `schemas/`; one route module per feature area.
- Frontend: Server Components by default; `"use client"` only where interactivity requires it. Authenticated Server Component fetches go in `*-server.ts` files with cookie forwarding.
- Prefer **extending an existing component with optional props** over forking (e.g. `MediaCard`/`MediaGrid` gained optional `href`/`badge` instead of a new card).
- **Don't build ahead of need.** Remove dead code when a feature is dropped (e.g. the `cta` prop was deleted once unused). No speculative abstractions.
- Comments explain **why**, including the bug or race that motivated a choice. Keep that style; it has repeatedly saved re-derivation.
- Styling: Tailwind utilities; palette: pink `#FF5FA2` (primary/active), mint `#8FE3C7` (secondary/ratings/"Last watched" on player), lavender `#C9A6FF` (links), background `#0B0B12`; display font via `var(--font-display)`.
- Season/episode are `None` for movies at the API boundary; the `-1` sentinel never leaks out of the service.

**Testing workflow (do this after every change)**
- Backend: `pytest -q` (real Postgres + Redis; TMDB mocked with `respx`). Every bug gets a regression test that reproduces the *reported scenario*.
- Frontend: `npx tsc --noEmit` and `npx vitest run`. Confirm only the four known live-backend files fail.
- Test gotchas learned the hard way:
  - `vi.clearAllMocks()` clears call history but **not** implementations; set `mockResolvedValue` explicitly per test.
  - `getByText("Pilot")` fails when JSX splits text into several nodes (`{n}. {name}`); use a regex.
  - `toHaveClass("text-[#FF5FA2]")` takes the literal class, **no escaping**.
  - Mocking `next/navigation` for `Nav` needs **both** `usePathname` and `useRouter` (NavSearch uses the router).
  - Mock `window.location` with `Object.defineProperty(window, "location", { value, writable: true, configurable: true })`, not `delete`/assign (TypeScript complains).
  - Page components now take `searchParams` (a Promise); direct calls in tests must pass `searchParams: Promise.resolve({})`.

**Delivery workflow (how the user receives work)**
- After each round: run all suites, strip `backend/.env`, `frontend/node_modules`, `tsconfig.tsbuildinfo`, `__pycache__`, `backend/subtitle-cache/*`, then zip `candyflix/` to `/mnt/user-data/outputs/candyflix-<topic>-vN.zip` (previous zips removed) and `present_files` it.
- The user replies with terse, numbered feedback and often docker logs. **Read the logs**; they have repeatedly contained the answer (e.g. that `updated_at` wasn't changing).
- Explain the **root cause** in plain language, not just the patch; flag trade-offs and anything assumed. When the request is ambiguous, state the interpretation you chose (the user corrects quickly).
- The user is a non-native English speaker; phrases like "hover the episode" meant *highlight*. Interpret intent, and when a report contradicts the code's expected behaviour, look for a data/timing explanation before assuming the UI is wrong.

## 9. Environment Setup (sandbox)

### 9.1 Backend + DB (sandbox has no services running by default)
```bash
apt-get update -qq && apt-get install -y -qq postgresql redis-server
service postgresql start; service redis-server start
su postgres -c "psql -c \"CREATE USER candyflix WITH PASSWORD 'candyflix' SUPERUSER;\""
su postgres -c "psql -c \"CREATE DATABASE candyflix OWNER candyflix;\""
cd candyflix/backend
cp .env.example .env
sed -i 's/^TMDB_API_KEY=$/TMDB_API_KEY=dummy_test_key_for_sandbox/' .env   # REQUIRED even though TMDB is mocked
python3 -m venv /home/claude/venv && /home/claude/venv/bin/pip install -q -r requirements.txt
/home/claude/venv/bin/python -m alembic upgrade head
/home/claude/venv/bin/python -m pytest -q
```
- Without a `TMDB_API_KEY` in `.env`, all TMDB-dependent tests fail with "TMDB_API_KEY is not configured" (looks alarming; it's just config).
- Services can stop between tool calls; check `pg_isready` and `redis-cli ping` before running tests.

### 9.2 Frontend
```bash
cd candyflix/frontend
npm install --no-audit --no-fund
npx tsc --noEmit
npx vitest run
```
(The `node_modules` folder is excluded from the zips; reinstall each time.)

## 10. The user's 7 updates (ORIGINAL SPEC — now implemented, see §12 for what was actually built)

The numbering is the user's own (1–7). Their wording is quoted (lightly cleaned; they are a non-native English speaker, so interpret intent). After each quote come the requirements as I understand them, then **notes/ambiguities**. When an ambiguity affects what you build, **state your chosen interpretation to the user** in the reply. They correct quickly. Nothing here has been implemented, and none of the code paths below were touched in the last session.

**Suggested order (the user may choose otherwise):** 7 (small) → 6 and 5 together (same component) → 2, 3, 4 together (all in `Nav.tsx`) → 1 (independent).

### Update 1 — Subtitle time offset: replace the slider with `<` value `>`

> "in subtitle setting, in time offset, we need to change, we dont need a bar like this, we want < and > button and the number in middle, and no limit, user should be able to change it as much as they want, and the text itself should have an option that user clicks on it and type, those two buttons should forward +100ms and -100ms. style of text should be this: -2.3 S . make the style so pretty"

Requirements:
- Remove the slider. Show `[ < ]  value  [ > ]`.
- `>` adds **+100 ms**, `<` subtracts **100 ms**, per click.
- **No limit at all**: no min/max in the UI, in the persisted preference, or in any clamp/validation. Search `subtitle-settings.ts`, `player-preferences.ts` and where `SubtitleOverlay` applies the offset, and update the existing tests (`subtitle-settings.test.ts`, `player-preferences.test.ts`, `subtitle-utils.test.ts`; **verify names**) that assert clamping.
- The number itself is **click-to-edit**: clicking turns it into an input where the user types a value. Commit on Enter or blur; Escape cancels; invalid input reverts to the previous value.
- Display format like **`-2.3 S`** (seconds, one decimal, unit `S`). The trailing "." in the user's message is sentence punctuation, not part of the format. They want it styled "so pretty". Design freedom within the palette (§8).

Notes / ambiguities:
- Unit when typing: assume **seconds** (matches the display). Say so.
- Keep the stored offset as an **integer number of milliseconds** to avoid `0.1 + 0.2` drift; format only for display. Decide how a typed value with more than one decimal is treated (suggest: accept, round to the nearest ms, display one decimal).
- Positive sign: show `+1.2 S` or `1.2 S`? The user only showed a negative example. Pick one and mention it.
- Hold-to-repeat, keyboard shortcuts etc. were **not** requested; don't build them.

### Updates 2 and 3 — Player-page search should be the normal search box (design together)

> 2: "when we click on search icon, the same search box that we have everywhere else should comes (and search icon should become to cancel button that hide search box again)"
> 3: "search bar in player page should work same as home screen and anywhere else, right now it opens small search box, it should be like our normal search box not like this"

Requirements:
- On `/watch/...` routes the header keeps the search **icon** (right side of the header). Clicking it reveals the **standard full-width search box** used on every other page. That is the `NavSearch` row rendered under the header (`border-t border-white/10 px-6 py-3 sm:px-10`), same placeholder ("What do you want to watch?"), same results dropdown and behaviour, **not** the small `w-48 sm:w-80` inline box that `PlayerHeaderSearch` currently renders.
- While it's open, the **icon turns into a cancel (✕) button** that hides the box again.
- Everywhere else nothing changes: the full-width row is always visible.

Notes:
- `__tests__/nav-player-search.test.tsx` currently asserts the OLD behaviour (small expanded input, a "Close search" button, collapse on outside click). Rewrite it for the new behaviour.
- The user only mentioned the cancel button. Simplest: **cancel button only** (no outside-click collapse, which can fight with the results dropdown). Say what you chose.
- Consider auto-focusing the input on open (check whether `NavSearch` supports it; it has not been modified for this).
- See §7.2 #11: search results navigate client-side away from the player.

### Update 4 — Small screens: search box full width, no side margin

> "in smaller screen (when items go and hamburger menu icon comes) search box should be full width screen, right now there is a margin in left and right that makes distraction"

Requirements:
- Below Tailwind `sm` (**640px**, where the nav links collapse into the hamburger), the search box spans the **entire viewport width** with no left/right margin. Today the row has `px-6`. Keep `sm:px-10` at ≥640px.
- Applies to the standard search row everywhere, and to the player-page version from updates 2–3.

Notes:
- "Full width screen" plausibly means edge-to-edge input, possibly with square side edges/no side borders. Check how `NavSearch` styles the input and choose a clean edge-to-edge look; mention it.
- The results dropdown must also be full width at that size.
- Verify visually at ~360/390/430px. The sandbox cannot render the browser; ask the user to check.

### Update 5 — Detail page: Watch Now + Add to Candy Box wrap onto two rows at ~650px

> "in smaller screen like in 650 px width, watch now and add to candy box are in two row, they are not in one line, please fix this with making buttons smaller in that size or ... whatever that makes it pretty. in bigger than that it works fine in one line, and also in smaller one (<640px) banner goes and they will be in one line again with same size that now is (which is good and big), and again in <410px it goes in two line again. but please be smart about it and do not make buttons always small because i like them big so user could see them and now it work correct in most sizes"

Facts about the current layout:
- `app/(main)/tv/[id]/page.tsx` and `movie/[id]/page.tsx`: the content row is `flex flex-col gap-6 sm:flex-row`; the poster is `hidden shrink-0 sm:block`, **220px** wide. At ≥640px the poster appears and squeezes the text column (where `DetailActions` lives), causing the wrap. Below 640px the poster is hidden, the column is full width, and the buttons fit on one line at full size. Below ~410px they wrap again.
- `DetailActions` container: `flex flex-wrap items-center gap-3`. Buttons: `py-3 text-base font-semibold` with `pl-5 pr-6` (Watch Now) or `px-6` (Candy Box).

Requirements:
- Keep buttons **big** wherever they already fit (≥ the wrap threshold, and roughly 410–640px). Shrink (padding/text) **only** in the range where they currently wrap (about 640px up to wherever the two buttons fit, which depends on the poster). Use range-limited breakpoints (Tailwind arbitrary values such as `min-[640px]:max-[Npx]:...`), or flex-1 shrinking, or a container query. Measure the real breakpoint rather than guessing.
- Also make the <410px case look intentional (e.g. two equal-width buttons, or a tidy two-row stack) instead of an accidental wrap.
- Test the **longest case**: a TV show with a resume label like `S10:E12` (the label widens Watch Now).
- Coordinate with Update 6 (same component; do them together).

### Update 6 — Watch Now vs Add to Candy Box sizing, and the resume label

> "when we have watch progress, in tv/movie detail, watch now button is bigger than add to candy box, and also still ugly, make the box same size, and also a rounded rectangle with same color and style, that shows watch progress. make it closer to watch now text"

Requirements:
- The two buttons must be the **same size**. Today the resume pill inside Watch Now makes it taller/wider than Add to Candy Box. Give both a fixed shared height at minimum (e.g. `h-12`); decide about width and say so.
- The resume label (`S1:E8`) becomes a **rounded rectangle** (not the current fully rounded pill), in "same color and style", and sits **closer to the "Watch Now" text**.
- Ambiguity: "same color and style" as what? It is either (a) the same colour family as the Watch Now button (a tonal chip on the pink button), or (b) the styling of the Add to Candy Box button (outline). Choose one, say which, and offer the other.
- Constraint from an earlier round: the label **must stay clearly legible** (it was previously "lost in the box colour"; the fix was a solid dark chip with white text). Don't regress that. It also must not make the button taller.

Current code: `DetailActions.tsx`. Watch Now is `<a class="flex items-center gap-3 rounded-xl bg-[#FF5FA2] py-3 pl-5 pr-6 text-base font-semibold text-[#0b0b12]">` containing a play icon, the text, and a pill `rounded-full bg-[#0b0b12] px-3 py-1 text-sm font-semibold text-white`. Candy Box is `rounded-xl border ... px-6 py-3 text-base font-semibold`. Tests: `__tests__/detail-actions-resume.test.tsx` (asserts the link's text content includes the label).

### Update 7 — Home hero banner: "Watch Now" is disabled

> "watch now button in home page banner is disable, make it enable"

Requirements:
- The hero carousel's Watch Now must be a working link. Likely file: `components/HeroCarousel.tsx` **(verify)**. Items are `MediaItem` (movie or tv).
- Movie → `/watch/movie/{tmdb_id}`.
- TV needs an episode. Options: (a) always `/watch/tv/{id}/1/1`; (b) resume the furthest episode using the same rule as the detail page and Continue Watching (`getLatestTVWatchProgress` client-side for the visible slide, fallback `S1:E1`). **(b) is more consistent** and is what I'd recommend; (a) is the simple fallback. Tell the user which you chose.
- Match the button style/sizing decisions from Updates 5–6 so the hero and the detail page don't drift.
- Check whether the hero has other disabled/placeholder controls, and whether any existing test covers `HeroCarousel`.

### Cross-cutting for all seven
- Follow the delivery workflow in §8: run pytest, `tsc`, vitest; new/changed behaviour gets tests; zip to `/mnt/user-data/outputs/candyflix-<topic>-vN.zip`; explain in plain language; flag assumptions.
- Layout/visual items (4, 5, 6, and the styling in 1) **cannot be verified visually in the sandbox**. Unit tests can check classes and structure only. Ask the user to eyeball specific widths.
- Update this handoff (or note in the reply) once these are done.

## 11. Immediate Next Steps (written before the 7 updates; §12 supersedes items 1–2)

1. **Orient:** set up the environment (§9), run baselines (§0), and give the user the short "where we stand" summary.
2. **Start on the 7 updates in §10** (order suggested there). For any update with an ambiguity, state your interpretation in one line and proceed. The user prefers speed and corrects quickly. For layout work, be explicit about which widths you reasoned about.
3. **Housekeeping worth offering (small, low risk):**
   - Update `README.md` to say Phase 7 is complete.
   - Check the suspicious `media-pages.test.tsx` "disabled Watch Now" assertion against a real backend (§7.2 #1). Update 7 is related to that button family.
   - Confirm the two inferred behaviours with the user: "returning to the latest episode clears In progress", and "a finished furthest episode hides the show from Continue Watching" (maybe they'd want next-episode logic).
   - Optionally add a Nav link to Continue Watching.
4. **If the user reports a progress/highlight oddity:** first ask for (or read) the `watch_progress` rows for that show. Most "bugs" so far were either real timing races (§3.4) or stale legacy rows from early testing. Reproduce with a backend test before changing UI logic.
5. **Do not** reintroduce a minimum-watch-time rule, an awaited save before navigation, or "most recently touched" as the resume definition. Each was tried and deliberately rejected (see §3.4 and §6).

---

## 12. Status after the 7 updates (v12)

**Baselines now:** backend 118 passed; `tsc` clean; Vitest 166 passed / 21 failed (the same four live-backend files, §7.1). +50 tests. Layout/visual work could **not** be seen in a browser here; the user must eyeball it (see "Please verify").

### What was built (and where it differs from the §10 notes)
- **Update 7 (hero Watch Now):** it was only *movies* that were disabled (hero passed no `watchHref`); TV already linked to `S1:E1` but never resumed. `DetailActions` no longer takes `watchHref`: movies derive `/watch/movie/{id}`; TV uses `tvProgress` when the page supplies it (detail page: value or `null`), otherwise (`undefined`, i.e. the hero) it fetches `getLatestTVWatchProgress` client-side, starting enabled at `S1:E1` and switching to the resume episode when the fetch lands (fetch error → stays `S1:E1`). The dead disabled branch was removed.
- **Update 6 (same size / chip):** both buttons are `h-12` and share **one width** (the wrapper is a `grid-flow-col auto-cols-fr w-fit`). The resume label is a solid dark **rounded-rectangle** (`rounded-md bg-[#0b0b12] text-white`, sized in `em` so it can't grow the button), 8px from "Watch Now". Chosen reading of "same color and style": same look as the Watch Now button (option a); the outline-style alternative was not built.
- **Update 5 (wrapping):** container queries (Tailwind v4 built-in `@[Npx]:`) on a wrapper around the buttons, so it reacts to the width the buttons actually get, not the viewport. Tiers: *big* (16px, 20px pad) → *compact* (15px/16px) → *tight* (14px/12px) → *stack* (two equal full-width rows, still big). Thresholds come in three sets by resume-label length (none / ≤5 chars like `S1:E8` / longer like `S10:E12`); numbers were derived from measured text widths (DejaVu Bold ×0.92 as an Inter proxy) plus a few px of safety — **tune them if the browser disagrees**. Also, on both detail pages the poster is now fluid, `w-[clamp(150px,20vw,220px)]`, so the text column has room at 640–~800px. Tailwind's compiled CSS was checked to emit the tiers in ascending order (needed for the cascade).
- **Updates 2+3 (player search):** `PlayerHeaderSearch` was removed. On `/watch/...` a header `SearchToggle` shows the search icon; clicking it renders the standard full-width `NavSearch` row and the icon becomes ✕ (`aria-label` flips "Search" ↔ "Close search"). Cancel button only — **no outside-click collapse**. The box auto-focuses on the player (new optional `NavSearch autoFocus` prop; off elsewhere) and closes on route change.
- **Update 4 (small screens):** search row is `px-0 sm:px-10`; below `sm` the input and results dropdown are square with no side borders (`max-sm:rounded-none max-sm:border-x-0`).
- **§7.2 #11 fixed:** `useWatchProgress` now sends a final `sendBeacon` save in its effect cleanup (only when `restored`). It reads the **captured** `video` element — React nulls `videoRef.current` before passive cleanups on unmount (a mutation test confirmed the test catches this).
- **Update 1 (subtitle offset):** new `components/player/OffsetStepper.tsx`: `‹  -2.3 S  ›` (body font, not italic), ±100 ms per click, click the number to type (seconds; Enter/blur commit, Escape cancels, invalid reverts), no limits. **Deviation from the §10 note:** the stored field stays `offsetSeconds` (float seconds) — no migration of saved localStorage. Drift is avoided by doing each step in whole ms (`stepOffsetSeconds`); helpers `formatOffset` ("+1.2 S"/"-2.3 S"/"0.0 S"), `formatOffsetForEditing`, `parseOffsetInput` live in `subtitle-settings.ts`. Positive values show a `+`. `loadSubtitleSettings` only rejects non-finite junk (not a range clamp). Not built (not requested): hold-to-repeat, shortcuts, reset button.
- **Housekeeping:** README says Phases 1–7 complete; old stale root `PHASE_HANDOFF.md` replaced by this document; `media-pages.test.tsx` movie-detail assertion corrected to "enabled Watch Now *link*" (still can't run without live TMDB — verify against a real backend).

### Please verify in a browser
1. Detail page (TV with `S1:E8` and with `S10:E12`, and a movie) at ~360, 390, 430, 650, 700, 800, 1100px: buttons equal size, one row where they fit, tidy stacked pair below that, chip legible and close to "Watch Now".
2. Home hero: movie Watch Now works; TV Watch Now resumes the right episode.
3. Player: icon → full-width box → ✕ hides it; typing works; picking a result leaves the player and its last position is saved.
4. <640px: search box is edge to edge on normal pages and on the player.
5. Subtitle settings: stepper look/feel, typing a value.

### Still open / ideas
- Items in §7.2 that were not part of this round (Continue Watching nav link, "next episode" logic, cleanup SQL for show 312949) are unchanged.
- If the layout tiers feel off, the single place to adjust is `GRID_BY_LABEL` at the top of `components/DetailActions.tsx`.

---

## 13. Phase 8 — Polish (STARTED)

Phase 8 scope per the user: *general loading/error states, mobile refinement, animations, empty states.* **Only the player work below is done so far**; the four general items are untouched. (The user chose to begin Phase 8 with player updates.)

**Baselines now:** backend 118 passed; `tsc` clean; Vitest 203 passed / 21 failed (same four live-backend files, §7.1). No ESLint config exists in the repo (`next lint`/`eslint` not runnable).

### Player: press-and-hold speed
- **Triggers:** finger / mouse (left button) / pen held on the video surface for 500 ms (`HOLD_DELAY_MS`), or the **Space bar** held ≥500 ms. Only engages while the video is *playing*; previous playback rate is restored on release (also on pointercancel and window blur).
- **Speed while holding a pointer:** starts at 2x wherever the hold began; sliding right → up to 4x at the player's right edge, left → down to 0.5x at the left edge (piecewise-linear, rounded to 0.1). This is **anchored at the hold start**, not absolute across the screen, so a hold near an edge doesn't jump to 0.5x/4x (trade-off: starting exactly on an edge leaves no room to slide that way). Space-hold is a fixed 2x.
- **Files:** `hold-speed.ts` (pure mapping + constants), `useHoldSpeed.ts` (hook: pointer + Space state machine), `HoldSpeedIndicator.tsx` (top-centre "▶▶ 2.3×" badge with a 0.5× · 2× · 4× gauge). Wired into `VideoPlayer`: pointer handlers on the tap-zone wrapper (now `touch-none select-none`, context menu suppressed), `handleTapZone` first calls `consumeSuppressedClick()` so the release of a hold doesn't toggle play/pause. Pointer capture is taken only once a hold engages (capturing on pointerdown would retarget ordinary tap clicks).
- **Behaviour change:** Space now toggles play/pause on **keyup** (tap) instead of keydown, so a hold can be told apart from a tap; it also `preventDefault`s keyup (Firefox would click a focused button).

### Player: shortcuts + tooltips
- **Shortcuts:** Space/K play-pause · J/L ∓10 s (with the skip pulse) · ←/→ ∓5 s · ↑/↓ volume · M mute · C subtitles · S settings menu · F fullscreen · Shift+N / Shift+P next / previous episode. Ctrl/Cmd/Alt combos are ignored (Ctrl+F / Cmd+C used to toggle fullscreen/captions before); auto-repeat only applies to seeking keys.
- **Stale-closure fix:** the keydown/keyup handlers are redefined each render and reached through `shortcutHandlersRef`, so they see current state (before, the `[]`-deps effect froze `allTracks`, so `C` could misbehave).
- **Tooltips:** `PlayerTooltip.tsx` wraps play, prev/next episode, mute, subtitles, settings (hidden while its menu is open) and fullscreen. Pure-CSS show: `group-hover` (hover-capable devices only) + `group-has-[:focus-visible]` (not plain focus, so clicking doesn't leave it stuck). Shortcut `<kbd>` chips render only when `useDesktopKeyboard()` is true — `(hover: hover) and (pointer: fine) and (min-width: 768px)`, false on first render for hydration safety. Buttons keep their original `aria-label`s; tooltips are `aria-hidden`.
- **Not done / ideas:** no tooltip on the seek bar or volume slider; no `0-9` jump, `<`/`>` speed, or Home/End keys; no on-screen shortcut cheat-sheet; Space-hold has no left/right speed control.

### Please verify in a browser (none of this could be seen here)
1. Phone: press-and-hold ~0.5 s mid-screen → 2x badge; slide right/left → 4x/0.5x at the edges; release → normal speed, and the release does **not** pause; a normal tap still pauses, double-tap still skips ±10 s; no text-selection/context menu/scroll fighting the hold.
2. Desktop: hold left mouse, and hold Space; tap Space still pauses/plays; all shortcuts above; tooltips appear on hover with shortcut chips, and on a phone/tablet show no shortcuts.
3. Tooltip positions at the far left (play) and far right (subtitles/settings/fullscreen), and in fullscreen.

### Remaining Phase 8 work (not started)
General loading/error states, mobile refinement, animations, empty states; plus the small leftovers in §7.2 / §11 (Continue Watching nav link, "next episode" logic, cleanup SQL for show 312949).

---

## 14. Phase 8 — batch 2: loading / error / empty states + motion (DONE, awaiting the user's visual check)

**Baselines now:** backend 118 passed; `tsc` clean; Vitest 237 passed / 21 failed (same four live-backend files, §7.1). +34 tests. `next build` could not be run in the sandbox (needs network for Google Fonts) — only `tsc` + Vitest + a Tailwind compile were.

### What exists now
- **Loading skeletons** (`components/Skeleton.tsx`): `Skeleton`, `LoadingRegion` (one polite `role=status` "Loading…", blocks `aria-hidden`), `MediaGridSkeleton` (uses the exported `MEDIA_GRID_CLASSES` from `MediaGrid.tsx`, so columns can't drift), `GridPageSkeleton`, `HomeSkeleton`, `DetailSkeleton`, `EpisodeListSkeleton`, `PlayerSkeleton`. `loading.tsx` files: `app/(main)/loading.tsx` (home skeleton; also the fallback for any (main) route without its own), `movies`, `series`, `candy-box`, `continue-watching` (grid), `movie/[id]`, `tv/[id]` (detail), `app/watch/loading.tsx` (black stage + spinner). Search page's Suspense fallback is a small skeleton.
- **Inline loading:** `MediaBrowser` — new `replacing` state: applying/clearing filters swaps the stale grid for 12 placeholders; "Load More" keeps the grid and appends 6 placeholders. `SearchPageClient` shows a skeleton grid on first search, a small "Searching…" while refining. `SeasonBrowser` shows `EpisodeListSkeleton`.
- **Errors:** `components/ErrorState.tsx` (client; `role=alert`; "Try again" uses the caller's `onRetry`, or — if none — `router.refresh()` via a small `RefreshButton` so the router hook is only used in that mode; `retry={false}`, `secondary` link, small-print `detail`). Boundaries: `app/(main)/error.tsx` (inside the layout so the header stays), `app/error.tsx` (watch/login/layout failures), `app/global-error.tsx` (own `<html>`, self-contained). Raw error text is never shown; Next's `digest` is shown as "Reference: …". Used for: Candy Box / Continue Watching / Movies / Series / Home errors, watch-page playback errors (title "Couldn't start playback" + "Back to details"), MediaBrowser (retries the failed first page or next page), SeasonBrowser (retry re-fetches the season via a nonce), search (no retry).
- **Not-found:** `components/NotFoundState.tsx` (big 404 + "Back to home"), used by `app/not-found.tsx` and `app/(main)/not-found.tsx` (the latter keeps the header for `notFound()` on unknown movie/show ids).
- **Empty states:** `components/EmptyState.tsx` (icon box/play/search/film, title, message, optional link or button action). Candy Box ("Your Candy Box is empty" → Browse movies), Continue Watching ("Nothing in progress" → Find something to watch), MediaBrowser ("Nothing to show" + the page's `emptyLabel`, with **Clear filters** when filters caused it), search ("No matches for “q”").
- **Motion:** `globals.css` — `fadeIn`/`fadeUp` keyframes and `.animate-fade-in`/`.animate-fade-up`, defined only inside `prefers-reduced-motion: no-preference`; a `reduce` block forces ~0 animation/transition durations app-wide (skeleton pulses become static; the player's pulses become instant too). `MediaGrid` wraps each card in an `animate-fade-up` div with a capped stagger (`min(index, 11) × 30ms`, so a "Load More" batch never drags). Home and both detail pages fade in on arrival. Empty/error/not-found blocks fade up.
- **Behaviour notes:** `MediaGrid` cards now sit inside a wrapper div (`min-w-0`). The old copy of the empty/error messages was kept where tests might match it; none did.

### Please verify in a browser
1. Slow-network feel: navigate Home → Movies → a title → Watch; each should show its skeleton (not a frozen page) and the layout shouldn't jump when real content lands.
2. Movies page: apply a filter (grid swaps to placeholders), filter to nothing (empty state + Clear filters), Load More (placeholders append); with the backend stopped, errors show Try again.
3. Visit `/movie/99999999` (not-found inside the layout) and `/nonexistent` (root 404).
4. Candy Box / Continue Watching with nothing in them.
5. OS "reduce motion" on: nothing fades or pulses.

### Remaining Phase 8 work
- **Mobile refinement** — not started; needs the user's specifics (things that look/feel off on a phone), since layout can't be seen in the sandbox.
- Possible extras (not requested): image fade-in for posters, hero crossfade review, a toast for transient errors (e.g. Candy Box add/remove failing), page-transition polish, a skeleton for NavSearch results.
- Small leftovers from §7.2 / §11 (Continue Watching nav link, "next episode" logic, cleanup SQL for show 312949).

---

## 15. Phase 8 — batch 3: stuck-skeleton fixes, toasts, image fade, search skeleton, mobile pass (DONE, awaiting the user's visual check)

**Baselines now:** backend 118 passed; `tsc` clean; Vitest 279 passed / 21 failed (same four live-backend files, §7.1). +42 tests this round. `next build` still can't run in the sandbox (Google Fonts).

### The "sometimes stuck on the skeleton" report — what was found and changed
Cause was **not reproducible here**; the user's Docker log showed (a) `GET /` taking 12–14 s (dev cold compile plus an uncached-TMDB Continue Watching call that took ~4.6 s, 0.1 s once cached) and (b) **no timeout on any frontend `fetch`**, so a stalled request makes a Server Component await forever behind its `loading.tsx` skeleton. Changes:
- `lib/api-client.ts`: `fetchWithTimeout(input, init, timeoutMs = FETCH_TIMEOUT_MS /*20 s*/)` + `RequestTimeoutError`. Merges a caller's own `AbortSignal` (the debounced search still cancels stale queries; reported as an AbortError, not a timeout). Covers waiting for response *headers* only. Applied to every data fetcher in `lib/media.ts`, `continue-watching-server.ts`, `watchlist-server.ts`, `playback-server.ts`, `session.ts`, `auth.ts` — a stall now throws and lands in the existing error states ("Try again") instead of hanging. **Not** applied to the fire-and-forget progress saves / beacons in `lib/playback.ts` / `lib/watchlist.ts` (client mutations).
- **Home** now starts all five requests (4 rows + Continue Watching) together; Continue Watching used to be awaited *after* the other four, stacking latencies.
- **Movie / TV detail** start the similar-titles request (and, for TV, the latest-progress request) together with the title request; side requests are `.catch`ed immediately so they can't become unhandled rejections when the title 404s.
- Log notes (not changed): `DEBUG=true` makes SQLAlchemy echo every statement — set `DEBUG=false` in the backend env for quieter logs; `/movie/99999999` returns HTTP **200** with the not-found UI because `loading.tsx` has already started streaming (Next behaviour, fine for a private app).
- If it still happens: check the browser Network tab for a pending `_rsc`/page request, and the frontend container log for that route's `GET ... in Ns`; a 20 s wait followed by the error state means a backend/TMDB stall rather than a rendering bug.

### The three extras
- **Toasts:** `lib/toast.ts` (module store: `showToast(message, kind="error"|"info"|"success", durationMs=4500)`, `dismissToast`, dedupes identical messages by restarting the timer, max 3 visible) + `components/Toaster.tsx` (mounted once in `app/layout.tsx`; bottom-centre, clears the iPhone home indicator, errors `role=alert`, others `role=status`, ✕ to dismiss). Wired to the one silent failure that mattered: `DetailActions` Candy Box add/remove. Toasts don't show inside fullscreen video (the Toaster is outside the fullscreen element).
- **Poster fade-in:** `components/FadeImage.tsx` wraps `next/image` for `MediaCard` posters. SSR HTML is fully visible; only an image still loading *at mount* is held transparent until `onLoad`/`onError` (so nothing depends on JS to appear). Opacity fades 0.5 s, hover-zoom transform stays 0.2 s. Not used on the hero / detail backdrops (priority/LCP images).
- **Search dropdown skeleton:** first results show placeholder cards; later keystrokes keep the previous results and show a quiet "Searching…" line.

### Mobile pass (code-level; no device to test on)
- `100vh`/`min-h-screen` → `dvh`/`min-h-dvh` everywhere (hero, detail backdrops, skeletons, layouts, login, not-found, dropdown, settings panel) — phone address bars no longer cause jumps. A guard test fails if a plain `vh`/`h-screen` creeps back.
- **Fixed a bug from batch 2:** the home skeleton's hero was 50vh vs the real hero's 75vh (page jumped when content arrived); now identical (`h-[75dvh] min-h-[460px] sm:min-h-[560px]`), guarded by a test.
- Player: the six 32px buttons become 40px and the seek bar's hit area doubles on touch devices (`pointer-coarse:` variants, Tailwind 4.3). The extra 24px in the control row is unverified on very narrow phones.
- `globals.css`: no grey tap flash, `touch-action: manipulation` on links/buttons (removes double-tap-zoom delay).
- `app/layout.tsx`: `viewport` export with `themeColor #0B0B12` and `colorScheme: "dark"`.
- Search input: `enterKeyHint="search"`, no autocapitalise/autocorrect/spellcheck/autocomplete.

### Please verify in a browser / on a phone
1. Reload the home page and navigate around a dozen times; if a skeleton ever sticks, wait 20 s — you should now get "Try again" rather than an endless skeleton. Report if it still sticks beyond that (and what the Network tab shows).
2. Make Candy Box fail (stop the backend, tap Add): a toast appears, button unchanged.
3. Scroll the grids: posters fade in; search: skeleton cards on first results.
4. Phone: address-bar collapse no longer resizes the hero/backdrops; player buttons feel bigger; check the control row still fits on a ~360px-wide phone; search keyboard shows a "Search" key and doesn't capitalise.

### Remaining Phase 8 work
Further mobile refinement only if the user finds specific issues. Small leftovers from §7.2 / §11 (Continue Watching nav link, "next episode" logic, cleanup SQL for show 312949) are still untouched. Candidate extras not built: hero image fade, toast on player-side failures, retry buttons inside the search dropdown.

---

## 16. Hero banner description (DONE) and Phase 9 plan (awaiting go-ahead)

- **Hero banner now shows a short synopsis under the title** (movies and TV): backend `MediaItem` gained optional `overview` (filled from TMDB trending/list items; `""`/missing → `null`; +1 backend test, now 119), frontend `MediaItem.overview?`, `HeroCarousel` renders `shortenOverview(overview, 180)` clamped to 2 lines on phones / 3 from `sm` up, with a text-shadow; nothing is rendered when there's no overview (+7 tests in `hero-carousel.test.tsx`). Note `overview` is now present on every list/search response (small payload increase; cards ignore it).
- **Phase 9 (Settings & personalisation)** — see `PHASE9_PLAN.md` for the full plan, decisions to confirm, and the 9a–9f build order. Nothing of Phase 9 is built yet.

---

## 17. Phase 9a — Settings foundation (DONE, awaiting the user's visual check)

Decisions and the full roadmap are in `PHASE9_PLAN.md` ("Confirmed decisions" section). **Baselines now:** backend 170 passed; `tsc` clean; Vitest 354 passed / 21 failed (the same four live-backend files, §7.1). +51 backend, +68 frontend tests this step.

### Backend
- **Migration `bc7270a45725`** (run `alembic upgrade head`): `users.is_admin` (bool, default false), `users.last_login_at`, new `user_settings` table (`user_id` PK/FK cascade, `data` JSON, `version`, `updated_at`). Data step: if no admin exists, the **oldest user becomes admin** (so an existing install has a first admin). Verified up/down/up.
- **Settings are stored sparsely** (`models/user_settings.py`): only what the person changed; defaults are merged at read time (`services/settings_service.py`) so improved defaults reach everyone who never touched a setting; no row = all defaults.
- **`schemas/settings.py`** defines the whole document (`appearance`, `playback`, `subtitles` groups) with defaults equal to today's behaviour (24 items/section, hero 7 s, seek 10 s, description `standard`, theme `candy-at-night`, ...) and validation (enums, ranges, hex colours). Groups for later phases already exist, so 9b–9g just start consuming fields. `subtitles` has **no timing offset** by design.
- **`/api/settings`** (auth required, own settings only): `GET` full resolved document · `PATCH` deep-merge (nested objects merge; **`null` resets a key to its default**; unknown keys and invalid values → **422 with a list of readable problems and nothing saved**; the stored value is the *validated* one, "12"→12) · `DELETE` reset all. A corrupt stored value is dropped on read (`resolve_leniently`) instead of breaking pages.
- **Roles:** `UserPublic` (own record: `/auth/me`, login) now has `is_admin`; the public `/auth/users` "Who's watching?" list uses the new `ProfileEntry` (no `is_admin`, so roles aren't visible to anyone). `deps.require_admin` (403) is ready for 9b. Login stamps `last_login_at`.
- **CLI:** `create-user ... --admin`, `set-admin <username> [--revoke]`, `list-users` shows `[admin]`.
- **Defaults parity:** `frontend/lib/settings-defaults.json` is the frontend's copy; a backend test fails if it drifts. Regenerate with:
  `cd backend && python -c "import json,sys; sys.path.insert(0,'.'); from app.schemas.settings import UserSettings; print(json.dumps(UserSettings().model_dump(), indent=2))" > ../frontend/lib/settings-defaults.json`

### Frontend
- `lib/settings.ts` (types, `applyPatch` mirroring the server's merge/null rule, `getSettings`/`patchSettings`/`resetSettings`, `SettingsError`), `lib/settings-server.ts` (`getServerSettings`: forwards the cookie, **never throws** — falls back to defaults).
- `components/SettingsProvider.tsx`: `useSettings()` → `{settings, update(patch), reset()}`. Changes show **instantly** (optimistic), save in the background; only the answer to the **most recently issued** save is adopted (a unit test caught an earlier version where a late stale response overwrote a newer change); failure → toast + re-sync. Works without a provider (defaults, no-op) so the login page/tests don't need one. Mounted in **`(main)/layout` and `watch/layout`**, which now load user + settings in parallel.
- **Name → menu** (`components/UserMenu.tsx`): avatar initial + name + chevron; menu = Settings, Log out; closes on outside click / Escape (focus returns) / navigation; arrow/Home/End keys; Admin badge for admins. Phone menu: name, Settings, Log out. `LogoutButton` takes an optional `className`.
- **`/settings`** (`app/(main)/settings/*`): sidebar on desktop / scrollable pills on phones; sections Appearance, Playback, Subtitles, Account, Privacy & data, About. Shared building blocks in `components/settings/controls.tsx` (`SettingsCard`, `SettingRow`, `Toggle`, `SegmentedControl`, `ComingSoon`). **Only two things are live in 9a:** Playback → **Seek time** (5/10/15/20/30 s) and About → **Reset all settings** (two-step). Everything else shows an honest "coming in an upcoming update" card.
- **Seek time drives the player:** arrow keys, J/L and the double-tap zones all use `playback.seek_seconds`, and the on-screen pulse shows the real number. **Behaviour change:** arrow keys used to skip 5 s (J/L and double-tap 10 s); now all use one value, default 10 s. (VideoPlayer itself isn't render-tested; a source-level test guards the wiring.)

### Please verify in a browser
1. Header: name button → menu (Settings, Log out); phone hamburger shows name, Settings, Log out. Log out still returns to "Who's watching?".
2. `/settings`: sections switch; Playback → pick a seek time, reload, it's remembered; open the same account on another browser/phone and it's the same. Arrow keys / J / L / double-tap use it.
3. About → Reset all settings (two clicks) puts seek time back to 10 s.
4. **Run the migration** (`alembic upgrade head` in the backend container) — the oldest account becomes admin; confirm with `python -m app.cli list-users`.

### Next: 9b Account & Admin (see PHASE9_PLAN.md)


---

## 18. Phase 9b — Account & Admin (DONE, awaiting the user's visual check)

**Note:** the sandbox was reset twice mid-phase and the first 9b implementation was lost; it was rebuilt from scratch and re-tested. **Baselines now:** backend **272 passed**; `tsc` clean; Vitest **385 passed** excluding the four live-backend files (login, logout, media-pages, nav-search — they need a seeded backend + TMDB and can't run in the sandbox; same as §7.1). +102 backend, +31 frontend tests this step.

### Backend
- **Migration `ba7454288764`** (chain `bc7270a45725 → ba7454288764`): `users.avatar_path`, `users.is_disabled`. Verified up/down/up.
- **Auto-migrate:** `entrypoint.sh` still runs `alembic upgrade head`; additionally `app/core/migrate.py` runs it in the app's lifespan (off the event loop, absolute paths, doesn't silence loggers) because `uvicorn --reload` skips the entrypoint. `AUTO_MIGRATE=false` disables the in-app step.
- **Sessions:** a `user_sessions:<id>` Redis set indexes each person's sessions → `invalidate_user_sessions(user_id, keep_token=None)`. Used on admin password reset / disable / delete (everywhere) and on a self password change (other devices only).
- **Disabled accounts:** correct password + disabled → 403 "disabled"; wrong password still 401 (no account probing); existing sessions get 401 "Account disabled" at once.
- **`/api/account`** (any signed-in user): `PATCH /profile` (display name only — username can't be changed here), `POST /password` (204; needs current password; must differ; ≥ 8 chars), `PUT /avatar` (multipart), `DELETE /avatar`.
- **Avatars:** validated and **re-encoded by Pillow** to 256×256 WebP, random filename, EXIF rotation applied, metadata stripped, JPEG/PNG/WebP/GIF only, ≤ 5 MB (`MAX_AVATAR_BYTES`), pixel cap; old file deleted on replace/remove/user delete (path-contained). Served at `/avatars/<file>` (StaticFiles); stored in `backend/avatars/`.
- **`/api/admin`** (all routes `require_admin`; 401 signed out, 403 regular user): users list/create/PATCH (username, display name, admin, disabled)/reset password/delete; `/stats` (counts, 14-day activity, top 5 titles, recent logins); `/system` (DB, Redis, TMDB live check, OpenSubtitles config-only, cache sizes, versions); clear TMDB cache (Redis `tmdb:*`), clear subtitle cache. **Safety rules live in the service layer:** can't disable/delete yourself, at least one active admin must remain, can't reset your own password via admin (use Account).
- New pip deps: `Pillow`, `python-multipart` (rebuild the image: `docker compose up --build`).

### Frontend
- `components/Avatar.tsx` (picture or coloured initial; falls back if the image fails) used in the header, phone menu, login picker and account/admin pages; picture URLs are `getStaticOrigin() + avatar_url`.
- **Settings → Account** (`AccountSettingsForm`): picture upload/remove, display name, read-only username, password change (confirm field, inline server errors), **disabled 2FA switch** ("coming soon — Telegram"). Changes call `notifyUserChanged()` so the header re-reads the person.
- **`/admin`** (`components/admin/*`): tabs Overview (stat tiles, 14-day bars, most watched, recent sign-ins), Users (add / edit incl. username & admin / reset password / disable-enable / delete with type-the-username confirmation; no destructive actions on your own row), System (health dots, cache clearing, versions). Non-admins who open the URL get an "Admins only" page; **Admin panel** link in the name menu and phone menu for admins only.

### Please verify in a browser
1. Rebuild and start (`docker compose up --build`); confirm the migration ran in the backend log.
2. Settings → Account: upload a picture (header and login picker update), change the name, change the password (other browser gets signed out).
3. As an admin: Admin panel → add a user (tick admin), reset a password, disable then try to sign in as them (should say disabled), delete a test user. Check System shows TMDB/DB/Redis state.
4. As a non-admin, open `/admin` — "Admins only".
5. CLI: `create-user x "X" --admin`, `set-admin x --revoke`.

### Next: 9c Appearance (colour-token migration → themes → home layout → episode view → description length)


---

## 19. Phase 9c — Appearance (DONE, awaiting the user's visual check)

**Baselines now:** backend 272 passed (unchanged — the settings schema already had every appearance key); `tsc` clean; Vitest **422 passed** excluding the four live-backend files (login, logout, media-pages, nav-search; same as §7.1). +38 frontend tests this step. No migration, no new dependencies.

### Colour tokens and themes
- **Every palette colour is now a token** in `app/globals.css` (`@theme`): `canvas` (page), `surface` (menus/dialogs/toasts), `surface-deep` (search overlay), `accent`, `accent-hover`, `on-accent` (text on the accent), `secondary` (lilac), `highlight` (mint). Use `bg-canvas`, `text-accent`, `border-l-highlight`, `bg-surface/95` … never a raw hex. White/black overlays (`text-white/60`, `bg-black/70`) stay as they are — they work on any dark palette. The 32 files were migrated mechanically; the card glow uses `color-mix(var(--color-accent))`; the player's active-icon fill uses `var(--color-accent)`.
- **Themes** = `html[data-theme="…"]` blocks overriding the tokens: Candy at Night (default, no block needed), Midnight, Mint, Lilac, Sunset, Mono. `lib/themes.ts` mirrors the key colours for the picker's swatches. **To add a theme:** add the CSS block, add it to `THEMES`, add the id to the backend `Theme` literal + `frontend/lib/settings.ts`. Tests check swatches == CSS, every theme defines every token, text-on-accent contrast ≥ 4.5:1, and **no component may hard-code a palette hex** (allowed exceptions: login avatar colours, subtitle colour pickers).
- **No flash:** the root layout (`app/layout.tsx`) is now async, reads the settings (`getServerSettings`, memoised per request so the layouts share one backend call) and writes `data-theme`, `data-text-size`, `data-motion` on `<html>`; `generateViewport` sets the phone address-bar colour from the theme. `SettingsProvider` keeps those attributes current, so picking a theme switches instantly. Signed-out pages get the defaults (the settings call just returns 401 → defaults).
- **Gotcha found while verifying:** a `*/` sequence inside a CSS comment (e.g. `bg-*/text-*`) silently ends the comment and breaks every rule after it; a test now parses `globals.css` with postcss.

### Settings → Appearance (all live)
Theme swatches · Home layout **Grid / Swipe rows** · Titles per section (12/18/24/36/48) · Banner on/off + rotation (5/7/10/15 s) · Show ratings · Show years · Episode list **Rows / Compact blocks** · Description length **Short / Standard / Full** · Text size (90% / 100% / 112.5% of the root font size — everything is rem) · Reduce motion **Auto / On / Off** (Auto follows the device; Off keeps animations even if the device asks to reduce them).
- *Swipe rows* (`components/MediaRow.tsx`): native horizontal scroll with scroll-snap; arrow buttons on hover for mouse devices (hidden on touch). `Section` takes `layout` and `max`; the home page passes them from the settings. Continue Watching is capped by the same value (the backend still fetches 24, so 36/48 only matters for the other rows).
- *Compact blocks* (`SeasonBrowser`): `[ 12 ] Episode name` chips in `grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]` — 1 column on phones, more on wider screens; same Now playing / Last watched / In progress states (name colour, small caption, progress bar). Works on the detail page and in the player's episode list. The summary is in the chip's tooltip.
- *Description length* (`lib/media.ts#overviewForLength`, `components/Overview.tsx`): "standard" is exactly today's behaviour (200 chars on detail pages, 180 in the banner); short ≈ 55% of that; full = whole text (banner clamps at 6 lines). Episode summaries clamp to 1 line / 2 lines / none.
- `MediaCard` is now a client component (reads show_ratings / show_years).

### Please verify in a browser
1. Settings → Appearance: click each theme — the whole app recolours at once, including the header menu, dialogs, toasts, the player (open a video) and the Admin panel. Reload: no flash of the old theme. Check the same account on a second device.
2. Home layout → Swipe rows: rows swipe on the phone (snap to cards); on desktop, arrows appear on hover. Titles per section changes the counts. Turn the banner off / change its speed.
3. Episode list → Compact blocks on a show page and in the player's episode list; resize to see 1/2/3+ columns.
4. Description length on the banner, a movie page, a show page, and episode summaries.
5. Text size Large/Small; Reduce motion On (animations stop) / Off.
6. Mono theme: white accent — confirm buttons/text on it are readable.

### Next: 9d Playback basics (autoplay next + Up-next overlay, cross-season next episode, auto subtitles, save-progress toggle + movie visit record + Clear history, per-video remember)


---

## 20. Phase 9d — Playback basics + feedback round (DONE, awaiting the user's check)

**Baselines now:** backend **303 passed**; `tsc` clean; Vitest **489 passed** excluding the four live-backend files (login, logout, media-pages, nav-search). **Migration chain:** bc7270a45725 → ba7454288764 → fe72be68484a (video_settings) → a1c3e5f70912 (site_settings). Auto-migrate applies them on start. Run `rm -f backend/avatars/*.webp` only to clear test avatars.

### 9d Playback basics
- Autoplay next episode with a 5 s Up-next overlay (crosses seasons via `findAdjacentEpisodes`), auto subtitles, "Save watch progress" (resume position only), movie visit record (keeps movies in Continue Watching with saving off), Clear watch history, per-video settings (`video_settings` table: volume, muted, subtitle_language) used when "Remember per video" is on.
- **Behaviour change to flag:** "Start playing when a video opens" defaults ON; before 9d the player never autoplayed.

### Feedback round
1. **Banner description toggle:** `appearance.hero_description` (default true), Settings → Appearance, HeroCarousel.
2. **New pages open at the top:** `components/ScrollToTop.tsx` in the (main) layout (scrolls on pathname change, leaves back/forward to the browser).
3. **TV detail season default:** SeasonBrowser opens on the just-visited episode's season, else the resume point's season, else the first.
4. **Equal-height compact blocks:** fixed `h-14`; Now playing / Last watched / In progress are now a small pill on the same row.
5. **Subtitle leak fixed:** a language picked in the player is saved per video only (no global "last used"); the timing offset is no longer stored in the shared localStorage blob. Style (colour/size/…) is still the shared default until 9e's Settings → Subtitles + per-video style.
6. **Continue Watching "View All"** shows when there are more than the section cap, not only when the backend says so.
7. **Footer:** public `GET /api/site/footer`, admin `GET/PUT /api/admin/footer`, table `site_settings`; `components/Footer.tsx` in the (main) layout; Admin → Footer tab (tagline, email, up to 8 links, copyright, on/off). Not shown on the login screen or the player.
8. **"In Candy Boxes" removed** from the admin Overview and the per-user list line (it was low-value and exposed what people save). API fields remain.
9. **Per-user list name:** "<first name> Box" in the nav, Add/In buttons, toasts and the list page (`lib/box-name.ts`, `BoxNameProvider`). Falls back to "Candy Box". Route stays `/candy-box`.
11. **Endless settings page:** `/settings` is one scrolling page with sticky full-width section bar (`SettingsBar`) and separated sections (`SettingsSection`); old `/settings/<section>` routes redirect to `/settings#<section>`.

### Please verify in a browser
Open a movie from halfway down a list (starts at top); TV page opens on the last-watched season; compact blocks equal height; set Persian subtitles in one episode, open another (off) and another show (off); Titles per section = 12 shows View All; Admin → Footer edit shows on all pages; Settings scroll/bar highlight on phone and desktop; a user named Amir sees "Amir Box".

### Later
Item 10 (big admin upgrade: drill-down, per-user info, public messages with "I understand" + acceptance stats, full visibility) becomes its own phase after 9g. Then 9e Subtitles, 9f Intro skipping, 9g Controls customiser.


---

## 21. Phase 9e — Subtitles (DONE, awaiting the user's check)

**Baselines now:** backend **309 passed**; `tsc` clean; Vitest **501 passed** excluding the four live-backend files. No migration (per-video values live in the existing `video_settings.data` JSON); no new dependencies.

### How it works (revised after the user's feedback: the look is site-wide)
- **The look** = `settings.subtitles` (server, per person, one set for the whole site): font, weight, size, text colour, background colour/opacity, outline, shadow, position, alignment. It can be changed in **Settings → Subtitles** (live preview; sliders save on release; "Reset style" is two-step) **and from the player's subtitle panel** — both write the same setting, so a change made in one episode applies everywhere.
- **Per video only:** the **language** and the **timing offset** (`video_settings`: `subtitle_language`, `subtitle_offset`, seconds, unbounded). Saved only while "Remember settings per video" is on; with it off they last until you leave the video. Nothing subtitle-related is shared browser-wide any more (the old localStorage blob is gone).
- An earlier version of 9e stored per-video style copies; that was dropped. The API now rejects per-video style keys (422); any old `subtitle_<style>` values in `video_settings` are ignored by the app and the review list.
- **Review list** (Settings → Subtitles, below the style card): videos that have their own language or timing. `GET /api/video-settings/subtitles` (titles via the cached TMDB lookup, "Title #id" if unavailable), `DELETE /api/video-settings/subtitles?…` (one video; volume/mute kept), `DELETE /api/video-settings/subtitles/all`.

### Please verify in a browser
1. Settings → Subtitles: change colour, size, position; the preview follows. Open a video: subtitles use it.
2. In the player, change the colour (or size) in one episode. Open another episode, a movie, another show: they all use the new look. Settings → Subtitles shows it too.
3. Pick a language and set the timing offset in one episode; no other video has them. Reopen the first: both are back.
4. Settings → Subtitles → list: the episode appears (language/timing); Reset forgets them for that video; Reset all.
5. Settings → Playback → turn off "Remember settings per video": language and timing no longer persist (the look still does).

### Next: 9f Intro skipping (SkipDB → IntroDB fallback, `/api/segments`, Skip Intro/Recap/Credits buttons, auto-skip), then 9g Player controls customiser, then the big admin upgrade.


---

## 22. Phase 9f — Intro skipping (DONE; the live services can only be checked by the user)

**Baselines now:** backend **330 passed**; `tsc` clean; Vitest **523 passed** excluding the four live-backend files. No migration, no new dependencies. Two new optional env-style settings (defaults are right): `SKIPDB_BASE_URL` (`https://api.skipdb.tv`), `INTRODB_BASE_URL` (`https://api.introdb.app`).

### Backend
- `GET /api/segments?media_type&tmdb_id[&season_number&episode_number][&duration]` (login required) → `{intro, recap, credits}`, each `{start, end, source}` in **seconds** or `null`. Never an error for the player: no IMDb id / TMDB trouble / providers down → all null.
- `services/segment_service.py`: TMDB id → IMDb id (existing `get_*_imdb_id`), then **SkipDB first** (`/api/segments?imdb_id&season&episode&duration`, its `outro` → our `credits`; `match: "out-of-range"` is ignored), then **IntroDB** (`/segments?imdb_id&season&episode` or `&is_movie=true`) only for the kinds SkipDB lacked. Both report ms (IntroDB's `start_sec/end_sec` accepted as a fallback). Bad data (end ≤ start, < 3 s, intro/recap > 600 s, credits > 3600 s, start past the file's length) is dropped; ends are clamped to the length.
- **Nothing is stored in Postgres** (a test checks no segment/skip table exists). Redis only: hits 24 h, "nothing known" 1 h, provider error 60 s. Cache key includes the file length rounded to 10 s (SkipDB uses it to match timestamps to the exact release).
- The two APIs' docs were read for this (SkipDB https://skipdb.tv/docs, IntroDB https://api.introdb.app OpenAPI). Tests use respx fixtures of those shapes; the real services weren't reachable from the sandbox.

### Player
- `components/player/skip-segments.ts` (pure logic) + `getSegments` in `lib/playback.ts` + wiring in `VideoPlayer`. Looked up once the video's length is known, only if auto-skip or any button is on.
- **Skip Intro / Skip Recap / Skip Credits** button (bottom right, same slot as "Up next"; hidden while "Up next" shows). Appears while that part plays (not for its last second); **fades away and returns with the player controls**; when a part begins the controls are brought up once so the button is noticed. Click = jump to the end of the part (credits → end of the credits, which leads into Up next / autoplay).
- **Auto-skip intro** (setting `auto_skip_intro`, default off): jumps past the intro as soon as playback is inside it, **once per video**; rewinding into it later is left alone (the button is still there). Intro only; works even if the Skip Intro button is switched off.
- Settings → Playback → **Skipping**: auto-skip toggle + one toggle per button (all buttons default on).
- SkipDB's terms: its data is never persisted by us (Redis cache only).

### Please verify in a browser (live services needed)
1. Settings → Playback → Skipping: toggles save. Open a popular show episode (try one from a major series): at the start of the intro the controls come up and **Skip Intro** appears; click it.
2. Turn **Skip intro automatically** on; open another episode: it jumps by itself; rewind into the intro: it does not jump again, the button is there.
3. Near the end, **Skip Credits** appears; clicking it goes to the end / next episode.
4. A title with no data (or the mock video): no buttons, no errors.
5. Watch the backend log for `segments: … failed` lines if nothing ever shows up (network from the server to api.skipdb.tv / api.introdb.app).

### Next: 9g Player controls customiser (control registry, customiser dialog with a placeholder image, persistence, extra controls); then the big admin upgrade phase (messages, drill-down, full visibility).


---

## 23. Phase 9g — Player controls customiser (DONE, awaiting the user's check)

**Baselines now:** backend **331 passed**; `tsc` clean; Vitest **542 passed** excluding the four live-backend files. No migration, no new dependencies. Regenerated `frontend/lib/settings-defaults.json` (§17 one-liner).

### What it does
- New setting `playback.controls` (backend `PlayerControls`, mirrored in `lib/settings.ts`): `episodes, volume, time, captions, fullscreen` (default on) and the extras `seek_back, seek_forward, pip` (default off). **Play/Pause and Settings have no key, so they can't be removed** (the API rejects an unknown key).
- `components/player/controls.ts` is the registry (id, label, description, shortcuts, locked/extra); the player and the customiser both read it, and a test checks it matches the settings keys.
- **Player (`VideoPlayer`)**: each button is drawn only when its control is on. **A removed control's shortcut is off too:** episodes → Shift+N / Shift+P; volume → M, ↑, ↓; captions → C; fullscreen → F; picture-in-picture → P (new). Seeking with ←/→/J/L, Space/K and S always work. The extras: two "jump back / forward by your seek time" buttons (next to Play) and a picture-in-picture button (only shown where `document.pictureInPictureEnabled`).
- **Settings → Playback → Player buttons → Customise…** opens `PlayerControlsDialog`: a mock-up of the control bar over the placeholder frame `frontend/public/images/player-preview.png` (**replace it with any ~1280×720 image under the same name**; see `public/images/README.txt`). Tap a button in the mock-up to remove it; removed ones stay as dotted ghosts to tap back. Below: a switch per control with its shortcut hint, locked rows marked "Always on", and "Back to the standard buttons". Changes save at once (same settings pipeline as everything else).

### Please verify in a browser
1. Settings → Playback → Customise… : the mock bar shows over the frame; remove Volume and Fullscreen; open a video — those buttons are gone, and M / ↑ / ↓ / F do nothing; ←/→ still seek.
2. Turn on Jump back / Jump forward: two buttons appear next to Play and move by your seek time. Turn on Picture in picture (Chrome/Edge/Safari): the button and the P key work.
3. On a movie the previous/next episode buttons never show; on a series, removing them also stops Shift+N / Shift+P.
4. Phone: the bar is still usable with fewer buttons (they wrap as before); Settings is always there.
5. "Back to the standard buttons" restores the original bar.

### Next: the big admin upgrade phase (public messages with "I understand", per-section / per-user drill-down, full visibility). It needs a short design pass with the user first (see PHASE9_PLAN.md "later").

## 24. Phase 10a — admin sees what people watch (v25)

**Backend:** `presence_service` (Redis `presence:<user_id>`, 45 s TTL), `POST /api/presence` and `/api/presence/stop`; admin `GET /admin/now-watching`, `/users/{id}/detail`, `/history?limit&offset`, `/watchlist`. Tests: `test_admin_activity.py`, extended `ROUTES` in `test_admin.py`.
**Frontend:** `usePresence` (15 s heartbeat, play/pause, pagehide, unmount stop) in `VideoPlayer`; `NowWatchingCard` (polls 10 s) on Overview; `UserDetailView` (profile, now watching, paged history, Candy Box) opened from a "View" button in Users; privacy row in Settings → Privacy & data. Tests: `admin-activity.test.tsx`.
**Limits:** history is the latest position per title/episode (not a play log). Presence is independent of "Save watch progress". Sign-ins show as a count only (full list comes in 10b).
**Baselines:** backend 353, frontend 545 (excluding the four live-backend files), tsc clean.
**Next:** 10b drill-downs, 10c messages, 10d audit trail.

## 25. Phase 10b — drill-down everywhere (v26)

**Backend (admin-only):** `GET /admin/titles` (every watched title, viewers/entries, paged), `/admin/titles/{movie|tv}/{id}/viewers`, `/admin/activity/{YYYY-MM-DD}` (UTC day, same grouping as the chart), `/admin/sign-ins` (everyone, last sign-in, active devices). Tests: `test_admin_drilldown.py`.
**Frontend:** Overview numbers are buttons: People → all people; Admins / Disabled / Active 7 days → filtered people list (client-side via `applyFilter`); Marked watched and "Most watched → See all" → titles → who watched → person; a chart bar → that day's activity; "Recent sign-ins → See all" → sign-ins. `AdminPanel` keeps a drill stack, so Back goes one level up with the right label; switching tabs clears it. Files: `DrillViews.tsx`, `OverviewTab.tsx`, `UsersTab.tsx` (filter/back props), `UserDetailView.tsx` (backLabel), `AdminPanel.tsx`. Tests: `admin-drilldown.test.tsx`.
**Limits:** "Sign-ins" shows last sign-in + live device count (the DB keeps only the last login time, not a login log). Days with 0 saves aren't clickable.
**Baselines:** backend 356, frontend 551 (excl. four live-backend files), tsc clean.
**Next:** 10c messages, 10d audit trail.

## 26. Phase 10c — messages with "I understand" (v27)

**DB:** migration `b7d2f4a91c33` (after `a1c3e5f70912`): `announcements`, `announcement_targets`, `announcement_acks` (all cascade on user delete; `created_by` SET NULL). Auto-migrates on start.
**Backend:** `announcement_service`; people: `GET /api/announcements/pending`, `POST /api/announcements/{id}/ack` (204, idempotent, 404 if not meant for you); admin: `GET/POST /admin/announcements`, `GET/PATCH/DELETE /admin/announcements/{id}`, `GET …/targets`, `POST …/reshow` ("ask everyone again" = clears acceptances). Tests: `test_announcements.py`.
**Rules:** audience "all" = every non-disabled person, incl. people added later; "selected" = chosen people. Shown while active (not stopped), not past `expires_at`, not yet accepted. Title ≤120, text ≤2000, end time must be in the future. Switching to "selected" needs people; switching to "all" drops the target list.
**Frontend:** `AnnouncementBanner` at the very top of the main layout (refreshes each minute and on tab focus; each message has its own "I understand"; failed save keeps it); admin **Messages** tab (`MessagesTab.tsx`): list with "x of y understood", New message dialog (everyone / chosen people, optional end time), message page with who understood + when, Edit, Stop/Show again, Ask everyone again, Delete (two-step). Tests: `announcements.test.tsx`.
**Baselines:** backend 364, frontend 560 (excl. four live-backend files), tsc clean.
**Next:** 10d audit trail (also a candidate home for a real sign-in log).

## 27. Phase 10d — audit trail + sign-in log (v28) — ends Phase 10

**Privacy note (user's request):** Settings → Privacy & data → "Activity": "Your activity on CandyFlix is visible to the server admin and is recorded to help with troubleshooting and keep things running smoothly." No list of what is recorded, but it does say the admin can see it.
**DB:** migration `c4e8a1d63b77`: `audit_log` (names are snapshots; user ids SET NULL so the trail survives deleting people) and `sign_in_log` (cascade; stores a truncated User-Agent, no IP).
**Backend:** `audit_service` (`record`, `list_audit`, `record_sign_in`, `device_label`). Logged: user create/edit/disable/enable/make-admin/remove-admin/password-reset/delete; looking at someone's history (first page) or Candy Box, once per admin+person per 10 minutes (polled screens like now-watching/detail aren't logged); message create/edit/stop/resume/ask-again/delete; footer edit; cache clears. Failed actions aren't logged. Every successful login adds a sign-in line (failed attempts aren't logged). `GET /admin/audit`, `GET /admin/sign-in-log?user_id`. Tests: `test_audit.py`.
**Frontend:** admin **Log** tab (`LogTab.tsx`): "Admin actions" as plain sentences ("Candy looked at Bob's watch history") and "Sign-ins" with device ("Chrome on Windows"), both paged. Tests: `admin-log.test.tsx`.
**Limits:** sign-in history starts from this version (older logins only have the last-login stamp). No retention/cleanup yet (rows are tiny; add a purge later if wanted). The log isn't tamper-proof against someone with database access.
**Baselines:** backend 371, frontend 564 (excl. four live-backend files), tsc clean.
**Phase 10 is complete (10a–10d).** Remaining older items: Continue Watching nav link; cleanup SQL for show 312949; 2FA via Telegram.

## 28. Phase 11 — subtitle sync (v29)

**What it does:** in the player's Subtitles panel, "Sync subtitle" re-times the selected subtitle against the video's audio (ffsubsync, no AI) and keeps the result. The button fills left→right with the real percentage; a line under it says what's happening ("Extracting audio and finding speech (38%)", "Looking for places where the delay changes", …). The job state is on the server, so a refresh shows the same running job.
**Script:** `backend/tools/sync_subtitle.py` (standalone CLI, also run by the server as a subprocess with `--progress-json`). Global offset + framerate fix, then a piecewise pass for delays that change along the film; piecewise segments are validated (`peak_z`) and gaps filled by a changepoint on a speech-fit score. The result is only used if it raises the speech-overlap score by ≥0.02. Benchmark on one real episode with 10 damaged copies (`/home/claude/sync/bench_final.py`): constant/drift/single step 100% of cues within 0.3 s; two steps 97.2%; big jump 98.9%; 90 s cut 98.1% (worst cues sit at a change point, up to ~6 s off). ~100–150 ms systematic bias remains. Cold 44-min audio ≈ 13–18 s, warm ≈ 2–4 s.
**Backend:** `services/subtitle_sync_service.py` (job in an asyncio task → subprocess; progress in Redis `subsync:<job>` for 1 h; one job at a time, others show "Waiting for another sync to finish…"; max 8 active; a "running" state with no live task is reported as interrupted). Results: `subtitle-cache/sync-<video>-<sub>.srt` + `.json` sidecar (language, label, method, quality) — the durable record; speech maps cached in `sync-cache/` (new setting `sync_cache_dir`, gitignored). Routes: `POST /api/subtitle-sync`, `GET /api/subtitle-sync/status` (states idle/queued/running/done/unchanged/failed). Playback sources now also list the video's synced tracks (`SubtitleTrackOut.synced`), replacing the unsynced track of the same language. Source subtitle must be a real `/subtitle-cache/*.srt`; synced files can't be synced again. `mock_provider.get_mock_video_path()` is the single place that says which file's audio is used — change it when the real video source is decided. Deps: `ffsubsync==0.5.1`, `srt`, ffmpeg in the Dockerfile.
**Frontend:** `SyncSubtitleControl.tsx` (polls every 1 s while queued/running), `lib/subtitle-sync.ts`, panel shows "Synced to this video ✓" and "· synced" in the track list; `VideoPlayer` lets a synced track replace its unsynced twin.
**Messages shown:** already in sync → "This subtitle already looks in sync with the video."; unsure → "Couldn't sync this one confidently, so it was left as it is. It may be for a different cut of the video."; crash/timeout (30 min) → "Syncing didn't work out. Please try again."
**Tests:** `test_subtitle_sync.py` (16, with a fake script printing the real JSON lines) and `sync-subtitle.test.tsx` (6). Also verified once end-to-end with the real script and audio through the service (progress 3→100 %, result identical to the standalone run).
**Baselines:** backend 387, frontend 570 (excl. four live-backend files), tsc clean.
**Limits / next:** (1) with the mock provider every video uses the one file in `mock-videos/`, so sync only makes sense when that file is the episode being watched; (2) no "use the original again" button yet (the original file is kept; offset stepper still works); (3) synced files are removed by Admin → clear subtitle cache (they can be regenerated); (4) AI sync for hard subtitles via an external API is still to come; (5) the quality gate (0.02) is calibrated on one episode.

## 29. Phase 11b — new subtitle menu with tabs and flags (v30)

**Menu:** the player's Subtitles panel is rebuilt (`SubtitleSettingsPanel.tsx`, now ~40 rem wide, capped to 94 vw). Top: what's showing (flag, name, "Turn off") and, for an unsynced subtitle, the Sync button. Below: tabs — a column on the left from tablet width, a row of four equal tabs on phones — **Source** (the video's own subtitles; empty note today because the mock provider has none), **OpenSubtitles**, **Synced** (only appears once a synced subtitle exists), **Style** (the old look + timing controls, unchanged). Opens on the tab of the subtitle in use.
**OpenSubtitles tab** (`OpenSubtitlesBrowser.tsx`): loads when first opened; results grouped by language (groups ordered by their most-downloaded file, inside a group by downloads), a flag tile on every row, download count, "HI" badge, tick on the one in use, "Show more" paging, skeleton/error+retry/empty states. The search box searches in the same list (450 ms debounce): a language name or code ("persian", "fa", "pt-br") becomes a server-side language filter; anything else is a release search ("bluray"). Old search box/dropdown removed.
**Flags:** `lib/flags.ts` maps a language code to a country (region in the code wins: pt-BR→Brazil, zh-TW→Taiwan; English→UK; unknown → neutral globe tile). Images in `public/flags/*.svg` (90 files, ~880 KB, flag-icons MIT, licence copied). `Flag.tsx` is the rounded tile (sm/md/lg). Shown in: the panel, the gear-menu "Subtitles" row, Settings → Playback (preferred/backup language), Settings → Subtitles' per-video list.
**Tracks:** `SubtitleTrackOut.origin` ("source" default, "opensubtitles" for anything fetched there; the auto default English is "opensubtitles"). One track plays per language and the **latest pick wins** (picking another English release, or finishing a sync, takes over; a synced file kept from an earlier visit beats the page's unsynced one). Fixes the old quirk where a second English release didn't replace the first.
**Tests:** `subtitle-menu.test.tsx` (17: flags incl. every flag file exists, grouping/sorting, language-vs-release search, download/pick, in-use marker, tabs, Sync button rules). Looked at phone (390 px) and desktop (1100 px) renders in Chromium.
**Baselines:** backend 387, frontend 587 (excl. four live-backend files), tsc clean.
**Limits:** the flag for a language is a best guess (a language isn't a country); the first OpenSubtitles page only shows the languages present in it — use the search for others; the Source tab stays empty until a real video source supplies subtitles.

## 30. Phase 11c — subtitle menu tweaks + admin/player fixes (v31)

**Subtitle menu:** (1) English is pinned first in the OpenSubtitles list with a small pin; other languages follow by downloads. (2) Each OpenSubtitles row shows the release name once (it used to show a shortened copy and the full copy). (3) Tabs moved to a compact row across the top and the panel is narrower (26 rem, was 40) with a slimmer header. (4) Opening the menu scrolls to the subtitle in use (inside the menu only, never the page); switching tabs does the same.
**Admin:** a person's own box is named after them ("Eve Box") in their detail tab, the audit log and the delete warning; it used to say "Candy Box". People rows have a ⋯ menu (`ActionMenu.tsx`: View, Edit, Reset password, Disable/Enable, Delete) instead of a row of buttons.
**Player:** the skip intro / recap / credits button is a solid white pill with an accent ring and a skip icon, and it now stays on screen for the whole segment (it used to fade with the controls). "Customise player buttons" now looks like the player (real icons moved to `player/icons.tsx` and shared, same rounded groups, progress bar, volume slider) and opens in a near-full-width dialog (`Dialog wide`).
**Tests:** admin tests use the ⋯ menu (helper `menuItem`), skip-button test rewritten, subtitle-menu tests extended. Baselines: backend 387, frontend 588, tsc clean.

## Planned next (the user's later requests, not started)
- **Phase 12 — more rating sources on the detail page:** Rotten Tomatoes, IMDb, Metacritic etc. with icons; each person can switch sources on/off in Settings; shown on the detail page only, not on cards. Needs a ratings data source (e.g. OMDb API key) and the icons (the user offered to upload them if the sandbox can't fetch them).
- **Phase 13 — feature banners on the home page:** three banners introducing CandyFlix features between the top three rows; admin can switch each off and edit its text; charming icon/illustration style.

## 31. Phase 12 — more rating sources on the detail page (zip: phase12-ratings-v1)

**File naming (changed):** zips are now `candyflix-phase<N>[letter]-<topic>-v<k>.zip` and **k restarts at 1 for every phase** (the old global counter v17…v31 is gone; existing zips were renamed that way). A zip holds only the files changed since the previous zip unless its name says `all-files`; apply them in order. `candyflix-phase11-all-files-v3` holds every Phase 11 file.
**Phase 11 follow-ups included here:** subtitle rows no longer overlap the download count (long release names wrap inside their box), the "HI"/"Synced" tags are gone from rows, and the English pin is a proper pushpin. (The file the user attached for the pin was a phone/WhatsApp-style icon, not a pin, so a standard pushpin was drawn instead — send the intended file if it should differ.)
**What it does:** a title's page (movie and show) shows score chips under the title: TMDB, IMDb, Rotten Tomatoes, Metacritic, each with its logo in its own colour; IMDb links to the title's IMDb page (with vote count), TMDB links to TMDB. Not on the poster cards. The old "★ 7.8" in the header line is replaced by the TMDB chip. Each person chooses the sources in Settings → Appearance → "Ratings on a title's page" (all on by default; new setting `appearance.rating_sources`).
**Data source:** OMDb (`omdb_api_key` in `.env`, free at omdbapi.com, 1,000 requests/day). One lookup by IMDb id gives IMDb, Rotten Tomatoes (critics %) and Metacritic. Cached in Redis (24 h; 1 h for "nothing there"; 10 min for errors/limit). No key, no IMDb id, or OMDb trouble = no extra chips (TMDB's own still shows). `GET /api/ratings/{movie|tv}/{tmdb_id}` -> `{ratings:[{source,label,display,suffix,value,votes,url}], configured}`. Written against OMDb's documented format and mocked tests; **not yet run against the live service** (no key in the sandbox).
**Not included (ideas):** Letterboxd, Trakt, Rotten Tomatoes audience score, Metacritic user score — OMDb doesn't have them. They would need another source (e.g. MDBList, which also needs a key); `ratings_service` is the one place to add it, and `RATING_SOURCES` in `lib/rating-sources.ts` and a logo in `public/ratings/` for the frontend.
**Icons:** `frontend/public/ratings/{imdb,rotten_tomatoes,metacritic,tmdb}.svg`, from the Simple Icons set (CC0) tinted in brand colours; replace the files to use other artwork.
**Frontend:** `DetailRatings.tsx`, `RatingIcon.tsx`, `lib/rating-sources.ts`; defaults JSON regenerated. **Tests:** `test_ratings.py` (12), `detail-ratings.test.tsx` (7), appearance tests (+2). Baselines: backend 399, frontend 597, tsc clean.

## 32. Phase 12b — ratings window, trailer, tidier subtitles (zip: `candyflix-phase12-ratings-v2`, applies after `-v1`)

- **Ratings are a click, not a row.** The header shows `year · runtime` plus a pill `★ 7.8 · Ratings` (`components/RatingsButton.tsx`). OMDb is called only when it's clicked (once per page view; a failed call retries on the next open). The Phase 12 chips row (`DetailRatings`), the Settings card and the `appearance.rating_sources` setting are gone (`settings-defaults.json` regenerated).
- **Trailer.** `get_movie`/`get_tv` add `append_to_response=videos` (no extra TMDB call); `_trailer_key` picks the best YouTube Trailer (official, newest; Teaser as a fallback). `trailer_key` is on `MovieDetail`/`TVShowDetail`. `components/TrailerButton.tsx` ("Watch trailer" pill in the same row, hidden if there's none) opens a youtube-nocookie embed in a dialog. Already-cached details (TMDB cache) show the button after the cache expires.
- **Admin → System** shows OMDb (key configured or not; never probes, to protect the 1000/day quota).
- **OpenSubtitles rows** show `summarizeRelease()` (`lib/release.ts`): source · resolution · codec · 10-bit/HDR · group, e.g. `BluRay · 1080p · x265 · 10-bit · RARBG`; the full release name is the hover title. Dots/spaces/underscores/brackets normalise the same.
- **Subtitle panel** slimmer (24rem, smaller header/tabs/rows, fewer dividers). Sync helper text is now "Fixes timing from the video's audio. Saved for next time."
- Tests: backend 401 pass; frontend suite passes (new: release, ratings-trailer; detail-ratings removed).
