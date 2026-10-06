# Phase 10 — Admin upgrade ("Candy can see everything")

The user's decisions (Oct 2026): the admin can see **what each person is watching right now**, their **full watch history**, and everything else on this server, drill into every section, and send **public messages** that stay on screen until the person clicks "I understand".

Because this shows people's activity to the admin, **every person is told so**: Settings → Privacy & data says "The server admin can see what you watch here: what's playing now, your history and your list." (Built in 10a.)

## Build order (each step ships green, with tests + handoff + zip)
- **10a Live + people (DONE, v25):**
  1. Presence heartbeat (`POST /api/presence`, Redis only, 45 s TTL) → **Watching now** card on the admin Overview (auto-refreshes) and on each person's page.
  2. **Person page** (Admin → Users → View): profile facts, what they're watching now, **full watch history** (every title/episode: where they stopped, how far, when; paged), their **Candy Box** contents, active sign-ins.
  3. The privacy notice for everyone.
- **10b Drill-down everywhere:** every number on the Overview opens its full list (admins, disabled, active in the last 7 days, titles with who watched them, all sign-ins, a day's activity).
- **10c Messages:** admin composes a message for everyone or chosen people; it shows at the top of the site until they press **I understand**; admin sees who has accepted (and when), who hasn't, counts; can edit/expire/delete. Table `announcements` + `announcement_targets` + `announcement_acks`.
- **10d Audit trail (small):** a log of admin actions (viewing someone's history, sending messages, account changes) so the "see everything" power is itself visible to the admin(s).

## Limits to remember
- History is the existing `watch_progress` table: one row per title/episode with the *latest* position and time. It is not a play-by-play log (no record of each separate viewing).
- "Watching now" comes from the player's heartbeat (every 15 s while a video is open). It works whether or not "Save watch progress" is on; nothing from it is stored in Postgres.
