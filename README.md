# CandyFlix

A small, private movie & TV app — built for Candy, and the people close to her.

CandyFlix uses TMDB for metadata and pluggable playback source providers
for streaming. It's intentionally simple: a handful of trusted users, no
enterprise auth, no generic "streaming platform" chrome.

## Status

**Phase 2 complete: authentication.** Small, private multi-user auth is
live — a `User` model, Argon2 password hashing, server-side sessions
(Redis-backed, HttpOnly cookies), a "Who's watching?" profile picker,
login/logout, and basic protected-route behavior.

No signup, OAuth, email verification, password reset, or 2FA — by
design. Users are provisioned via `app/cli.py` (see below).

No product features (TMDB browsing, watchlist, playback) are
implemented yet — see `PHASE2_SUMMARY.md` (or the conversation history)
for exactly what exists so far.

## Stack

- **Backend:** FastAPI, SQLAlchemy (async), PostgreSQL, Redis, Alembic
- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Infra:** Docker Compose for local development

## Project Structure

```
candyflix/
  backend/     FastAPI app (modular monolith: api/ services/ providers/ models/ schemas/ core/)
  frontend/    Next.js app
  docker-compose.yml
```

## Running locally with Docker (recommended)

1. Copy env files:
   ```
   cp backend/.env.example backend/.env
   cp frontend/.env.local.example frontend/.env.local
   ```
2. Start everything:
   ```
   docker compose up --build
   ```
3. Visit:
   - Frontend: http://localhost:3000
   - Backend: http://localhost:8000/api
   - Health check: http://localhost:8000/api/health/full

## Running locally without Docker

**Backend** (requires local PostgreSQL + Redis running):
```
cd backend
pip install -r requirements.txt --break-system-packages   # or use a venv
cp .env.example .env    # edit DATABASE_URL/REDIS_URL if needed
uvicorn app.main:app --reload
```

**Frontend:**
```
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

## Environment Variables

See `backend/.env.example` and `frontend/.env.local.example` for the
full list. Nothing sensitive is committed — `.env` and `.env.local`
are gitignored.

## Creating users (no signup — invite-only by design)

There's no public signup form. Create each person's account via the
CLI, which prompts for a password securely (never as a CLI argument,
so it never lands in shell history):

```
docker compose exec backend python -m app.cli create-user candy "Candy"
docker compose exec backend python -m app.cli create-user mom "Mom"
docker compose exec backend python -m app.cli create-user sister "Sister"
```

List existing users:
```
docker compose exec backend python -m app.cli list-users
```

Running without Docker: same commands, just `python -m app.cli ...`
from inside `backend/` with your virtualenv active.

## Implementation Plan

1. ✅ Project setup
2. ✅ Auth (User model, Argon2 hashing, sessions, "Who's watching?" UI)
3. TMDB integration (trending, search, details, seasons/episodes)
4. Candy UI (Candy at Night visual system, layout, navigation)
5. Playback providers (`PlaybackSource` abstraction, mock providers)
6. Candy Box (per-user watchlist)
7. Continue Watching (per-user progress)
8. Polish (loading/error states, mobile, animations)

Future, out of scope for now: **Candy Server** — a server-side media
pipeline for content we have legitimate rights to. See architecture
docs for the extensibility hooks already in place for this
(`source_type` field, `PlaybackSource` abstraction).
