# Phase 9 — Settings & personalisation (decisions CONFIRMED; 9a built — see 'Confirmed decisions' below, which supersede anything above)

Goal: a real Settings area where each person tunes how CandyFlix looks and plays, plus the new features some settings need (intro skipping, autoplay next, customisable player controls, per-video subtitle settings).

## 0. Facts that shape the design (checked in this repo / on the web)

- **Colours are hard-coded**: `#FF5FA2` ×71, `#0B0B12` ×35 and a few others across 22 component/app files. Themes therefore need a **token migration first** (CSS variables + Tailwind `@theme` colours, then a mechanical replace), otherwise "pick a palette" can't work.
- **Settings today** live only in `localStorage` (`candyflix:subtitle-settings`, `candyflix:player-preferences`) — per browser, not per person, and not shared between phone and desktop. The nav shows `display_name` + a Log out button (desktop row and mobile menu).
- **Intro databases** (both free to read, no key, keyed by **IMDb id**, not TMDB id):
  - IntroDB — `introdb.app` (API host `api.introdb.app`): intro / recap / outro (and post-credits) segments per episode; crowd-sourced.
  - SkipDB — `GET https://api.skipdb.tv/api/segments?imdb_id=&season=&episode=&duration=` → `{segments:{intro,recap,outro,preview}}`, each the best match or `null`, in seconds *and* ms; `duration` (stream length in seconds) lets it shift timestamps for streams that differ by up to ~15 s; also returns `intro_length_estimate_ms` for a "skip ~Xs" fallback. Rate limit 120 req/min.
  - We have TMDB ids → the backend must resolve the IMDb id through TMDB (`/tv/{id}/external_ids`, `/movie/{id}`), cached.
  - **SkipDB licence (ODbL + reciprocity):** read-only use to show skip times to end users is explicitly fine, but *storing their data in our own skip-segment database* would trigger share-alike duties. So: **pass-through with a short Redis cache only — never persist segments in Postgres.** Credit both sites in Settings → About.
  - The build sandbox can't reach either host, so these clients will be written against the docs and tested with mocked responses; **the user must verify against the live services** (I'll add a log line saying which provider answered).

## 1. Decisions (recommended defaults — change any you disagree with)

1. **Entry point:** the name becomes a button with a small avatar initial → dropdown: **Settings · Switch profile · Log out** (mobile menu: same three items under the name). Rationale: one control instead of name + gear + button; leaves room for more items later. Settings opens `/settings` (sidebar of sections on desktop; a list that drills into each section on phones).
2. **Storage:** per-user settings **on the server** (new `user_settings` table, one JSON document per user + schema version) so phone and desktop agree. localStorage keeps an instant local copy; a tiny **cookie mirror** of the settings that affect server rendering (theme, home layout, episode view, description length) so pages render correctly with no flash.
3. **Per-video overrides:** their own table keyed by (user, movie | tv show, season, episode) — for subtitle track/offset/style and volume — used only when "Remember settings per video" is on. Resolution order: **episode → show → my defaults**. In the player's subtitle panel a changed value asks/shows "applies to: this episode / this show / everything" (default: this episode for timing offset and track; everything for style). Settings → Subtitles has a list of saved overrides with delete / reset all.
4. **Themes:** ship **dark palettes only** at first (Candy [current default], Midnight blue, Mint, Lilac, Sunset, Mono/AMOLED). A light theme touches hundreds of `text-white/xx` classes — a separate later step if wanted.
5. **Autoplay next episode:** default **ON** with an "Up next — playing in 5 s [Cancel] [Play now]" overlay; crosses season boundaries; last episode of the show just stops. Separate toggle "Start playing when a video opens" (default ON = today's behaviour).
6. **Auto-skip policy ("use both sources to make sure"):** query both in parallel (4 s timeout each). Intro segments **agree** if start and end are each within 3 s → *confirmed* (merged conservatively: later start, earlier end). Only one source has it → *single-source*. They disagree → *conflict*. The **Skip Intro button** shows for any of these; **auto-skip** only for *confirmed* by default, with an option "also auto-skip single-source results" (off by default). Conflicts never auto-skip. Same machinery can offer "Skip Recap" and "Skip Credits / Next episode" (cheap, data is already there) — proposed as optional toggles, default on for buttons, off for auto.
7. **Watch progress OFF** = stop saving *and* stop resuming (existing history is left alone, with an explicit "Clear watch history" button in Settings → Privacy & data).
8. **Player controls customiser:** a dialog showing a mock player (placeholder image at `frontend/public/images/player-preview-placeholder.svg` — **you replace it**; same filename or tell me the new one) with the control bar overlaid as draggable chips and an "Available actions" tray; drag to reorder, drag to the tray to remove, drag back to add, "Reset to default". Touch + keyboard supported via `@dnd-kit` (new dependency). Settings (gear) and Play/Pause can't be removed so nobody locks themselves out; keyboard shortcuts keep working for removed buttons. New optional buttons made available: Back/Forward (seek time), Speed, Picture-in-Picture, Sleep timer, Next episode.

## 2. Settings sections (what each contains)

**Appearance** — Theme (palette swatches with live preview) · Home layout: *Grid* (current) / *Swipe rows* (one scrollable row per section, scroll-snap, arrows on desktop) · Items per section · Episode list style: *List* (current) / *Compact blocks* (`[ 12 ] Episode name` chips; adaptive columns via `auto-fill/minmax`: ~1 column on phones, 2 on small tablets, 3–4 on desktop; applies to the detail page and the player's episode list) · Description length: *Short / Standard (current default) / Full* · Extras I suggest: text size (S / default / L), reduce-motion override (Auto/On/Off), hero banner on/off + rotation speed, show/hide ratings and years on cards.

**Playback** — Autoplay next episode (+ Start playing when opened) · Auto-skip intro (+ recap/credits buttons, + single-source toggle) · Player controls → *Customise…* · Seek time: 5 / 10 / 15 / 20 / 30 s (arrow keys, J/L, double-tap zones, the pulse label) · Auto subtitles: preferred language (+ fallback, or Off) · Save watch progress · Remember settings per video (volume, subtitles).

**Subtitles** — the same controls as the in-player panel (font, size, colour, background, shadow, position, timing) as the default look, with a live preview line, plus the per-video overrides list.

**Suggested extra sections (small, high value):** *Account* (display name, change password) · *Privacy & data* (clear watch history, clear Candy Box, export my data) · *Keyboard shortcuts* (cheat-sheet of what we built) · *About* (version; credits for TMDB, OpenSubtitles, IntroDB, SkipDB) · global *Reset all settings*.

## 3. Build order (each step ships green: tests + handoff + zip, and you check it before the next)

- **9a Foundation:** backend `user_settings` (+ Alembic migration, GET/PUT API, validation, defaults), frontend settings provider + cookie mirror, nav dropdown, `/settings` shell with section navigation, reset-all. No visible settings yet except the shell.
- **9b Appearance:** colour-token migration (mechanical, test-guarded) → themes → home layout (grid/swipe) → episode view (list/blocks) → description length → the extras.
- **9c Playback basics:** seek time, autoplay next + Up-next overlay (+ real "next episode" logic across seasons), auto subtitles, save-progress toggle (+ Clear history), per-video remember toggle plumbing.
- **9d Subtitles:** settings page, per-video/episode/show overrides + the "applies to" control in the player.
- **9e Intro skipping:** backend segment service (TMDB→IMDb id, IntroDB + SkipDB clients, agreement logic, Redis pass-through cache, `/api/segments`), player Skip Intro / Recap / Credits buttons, auto-skip, settings.
- **9f Player controls customiser:** control registry refactor of `VideoPlayer`'s bar, customiser dialog with the placeholder image, persistence, extra controls.

## 4. Risks / things to know
- Theme migration touches ~22 files — done mechanically with a guard test that fails if a raw palette hex returns.
- 9e can only be verified live by you (hosts unreachable from the sandbox); the logic (matching, merging, timing, button/auto-skip behaviour) is fully unit-tested with recorded-style fixtures.
- Placeholder player image is yours to replace; layout of the mock-up overlay is positioned to a standard 16:9 frame.
- The mock video's content won't match real intro timestamps — test auto-skip with a real show.


---

# Confirmed decisions (the user's answers) — these supersede the plan above

1. **Entry point:** name opens a menu. ✔ built (9a). Items: **Settings · Log out** (+ **Admin panel** for admins, added in 9b). "Switch profile" was dropped: the login screen *is* the "Who's watching?" picker, so it would just duplicate Log out.
2. **Storage:** per-user, on the server. ✔ built (9a). *Revised:* no cookie mirror — the layouts fetch settings on the server in parallel with the user lookup and seed the client provider, so there is no flash and no extra moving part.
3. **Theme name:** the current look is called **"Candy at Night"** and is the default (theme id `candy-at-night`). Other palettes: Midnight, Mint, Lilac, Sunset, Mono. Dark only for now.
4. **Autoplay next:** default ON with the 5 s "Up next" overlay.
5. **Watch progress — decided by me, as asked.** In the code, *which episode you last opened* (the `S1:E8` label, the "in progress" mark, Continue Watching) and *where you stopped* (resume position) are two separate writes into the same `watch_progress` table (`POST /watch-progress/tv/visit` vs the periodic `POST /watch-progress`). So they are separate settings behaviours: the **"Save watch progress" toggle controls the resume position only** — off = don't save it and don't jump back to it. Last-watched / in-progress / Continue Watching keep working regardless (no second toggle; "Clear watch history" lives in Privacy & data). *Needs doing in 9d:* movies currently get their Continue Watching entry from the first position save, so a movie "visit" record must be added, otherwise movies would vanish from Continue Watching when saving is off.
6. **Per-video subtitle/volume settings:** *no "apply to…" prompt.* A change made inside the player applies to **that video only** (that movie / that episode) and is remembered for it (when "Remember settings per video" is on). **Settings → Subtitles** edits only the settings that are safe to apply everywhere (colour, size, font, background, outline/shadow, position, alignment) and a change there applies to **all** subtitles, *including videos that already have saved settings*: changing a global value clears that same key from every per-video override. Changing it again inside one episode makes a per-video override again. **Timing offset (and the chosen track) are per-video only** — never global.
7. **Player controls customiser:** agreed — *and removing a control also disables its keyboard shortcut* (no separate keyboard settings; "keep working for removed buttons" is dropped). Play/Pause and Settings can't be removed.
8. **Intro skipping — simplified:** *one* provider with the other as **fallback** when the first has no data (no cross-checking/agreement logic). Order is a backend config value; default **SkipDB first** (it uses the stream length to correct timestamps), IntroDB as fallback. Behaviour: while playing inside the intro window a **"Skip Intro" button appears and then hides on its own after a few seconds**; it comes back whenever the player controls are shown (tap/move). With **auto-skip** on, it skips by itself — **once**; rewinding back into the intro never triggers it again. SkipDB data is never stored in our database (licence) — short Redis cache only.
9. **Admin panel (new):** for admins — add a user (username + password), make/revoke admin, reset a user's password, change a username (**only admins can change usernames**), disable/delete users, plus a useful dashboard: user count, recent logins, watch activity/popular titles, library/Candy Box counts, system health (backend/DB/Redis/TMDB/OpenSubtitles status), cache controls (TMDB cache, subtitle cache size + clear), recent activity.
10. **Account settings** (every user, in Settings → Account): change **profile picture**, display name, password; **2FA toggle shown but disabled** ("coming soon — via Telegram bot later"). Username is read-only for non-admins.

## Revised build order
- **9a Foundation — DONE** (see PHASE_HANDOFF.md §17).
- **9b Account & Admin — DONE** (see PHASE_HANDOFF.md §18; originally: `avatar_path`, 2FA placeholder columns, avatar upload (validate, resize, serve), account section, admin routes + `/admin` UI (users, dashboard, system), `last_login_at` already recorded).
- **9c Appearance — DONE** (see PHASE_HANDOFF.md §19; originally: colour-token migration → themes (default Candy at Night) → home layout (grid/swipe rows) → episode view (list/blocks) → description length → extras).
- **9d Playback basics (DONE):** autoplay next + Up-next overlay (+ cross-season next-episode logic), auto subtitles, save-progress (resume only) + movie visit record + Clear history, per-video remember plumbing.
- **9e Subtitles:** global style page, per-video overrides (+ clear-key-on-global-change), review/delete list.
- **9f Intro skipping:** TMDB→IMDb id, SkipDB→IntroDB fallback, `/api/segments`, player button + auto-skip.
- **9g Player controls customiser** (placeholder image in `frontend/public/images/`), extra controls.
