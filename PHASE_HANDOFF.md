# CandyFlix — Project Handoff (through Phase 7 + the 7 follow-up updates)

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
| 7+ | The user's **7 follow-up updates** (§10): subtitle offset stepper, player-page search, small-screen search, detail-page button layout/sizing, hero Watch Now | **Implemented, tested (unit); awaiting the user's visual check** (see §12) |

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
- **Update 1 (subtitle offset):** new `components/player/OffsetStepper.tsx`: `‹  -2.3 S  ›`, ±100 ms per click, click the number to type (seconds; Enter/blur commit, Escape cancels, invalid reverts), no limits. **Deviation from the §10 note:** the stored field stays `offsetSeconds` (float seconds) — no migration of saved localStorage. Drift is avoided by doing each step in whole ms (`stepOffsetSeconds`); helpers `formatOffset` ("+1.2 S"/"-2.3 S"/"0.0 S"), `formatOffsetForEditing`, `parseOffsetInput` live in `subtitle-settings.ts`. Positive values show a `+`. `loadSubtitleSettings` only rejects non-finite junk (not a range clamp). Not built (not requested): hold-to-repeat, shortcuts, reset button.
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
