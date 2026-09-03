# CandyFlix

A small, private movie & TV app — built for Candy, and the people close to her.

CandyFlix uses TMDB for metadata and pluggable playback source providers
for streaming. It's intentionally simple: a handful of trusted users, no
enterprise auth, no generic "streaming platform" chrome.

## Status

**Phase 3 complete: TMDB integration.** Trending, search, movie
details, TV details, and season/episode listings are live, backed by
Redis caching and normalized into CandyFlix's own schemas.

No frontend UI for browsing yet — that's Phase 4. This phase is
backend-only, verified via a mocked-TMDB test suite (see `backend/tests/`)
plus live smoke-testing once you add your own TMDB key.

Phase 2 (auth) remains as before — a `User` model, Argon2 hashing,
sessions, "Who's watching?" picker, login/logout.

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
   (The backend container applies database migrations automatically
   on startup — no manual `alembic upgrade head` step needed here.)
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
alembic upgrade head    # applies migrations — required before first run
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

## TMDB Setup

CandyFlix uses TMDB for all movie/TV metadata. Get a free key:

1. https://www.themoviedb.org/settings/api → request an API key ("Developer" use)
2. Copy the **API Key (v3 auth)**
3. Add it to `backend/.env`: `TMDB_API_KEY=your_key_here`

Without a key, trending/search/detail endpoints return a clear
`500 TMDB_API_KEY is not configured` rather than failing silently.

### Media endpoints (Phase 3)

```
GET /api/trending                              # today, movies+tv mixed
GET /api/search?q=...                          # movies+tv
GET /api/movies/{tmdb_id}                      # movie details
GET /api/tv/{tmdb_id}                          # tv show details + season list
GET /api/tv/{tmdb_id}/season/{season_number}   # episode list for a season
```

Responses are cached in Redis (15 min for trending/search, 6 hours
for details) to stay within TMDB's rate limits.

## Testing

**Backend** (TMDB is mocked — no API key or network needed to run these):
```
cd backend
python -m pytest tests/ -v
```

**Frontend** — mounts the real components and drives them with real
clicks/typing; network calls go to a real running backend, so start
the backend first:

```
cd backend && ./entrypoint.sh &     # or: alembic upgrade head && uvicorn app.main:app --reload
cd frontend
npm run test
```

## Implementation Plan

1. ✅ Project setup
2. ✅ Auth (User model, Argon2 hashing, sessions, "Who's watching?" UI)
3. ✅ TMDB integration (trending, search, details, seasons/episodes)
4. Candy UI (Candy at Night visual system, layout, navigation)
5. Playback providers (`PlaybackSource` abstraction, mock providers)
6. Candy Box (per-user watchlist)
7. Continue Watching (per-user progress)
8. Polish (loading/error states, mobile, animations)

Future, out of scope for now: **Candy Server** — a server-side media
pipeline for content we have legitimate rights to. See architecture
docs for the extensibility hooks already in place for this
(`source_type` field, `PlaybackSource` abstraction).
