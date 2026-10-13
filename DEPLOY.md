# Running CandyFlix on a VPS

Development stays exactly as it is (`docker compose up`). The server uses its own files:
`docker-compose.prod.yml`, `Caddyfile`, `.env.prod`, `backend/.env.prod`, `deploy.sh`.

## One-time setup

1. A small Linux VPS (2 GB RAM is comfortable) with Docker and the Docker Compose plugin.
2. A domain with an **A record** pointing at the server's IP. Open ports 80 and 443 in the firewall.
3. Copy the project to the server (git clone, or unzip), then:
   ```
   cp .env.prod.example .env.prod                 # DOMAIN and POSTGRES_PASSWORD
   cp backend/.env.prod.example backend/.env.prod # SESSION_SECRET (openssl rand -hex 32), TMDB, Telegram, resolver...
   ./deploy.sh
   ```
   Caddy gets the HTTPS certificate by itself the first time (give it a minute).
4. Make the first people:
   ```
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend python -m app.cli create-user dad "Dad" --admin
   ```

The backend refuses to start in production with the placeholder `SESSION_SECRET`.

## Every update

Push your changes, then on the server run `./deploy.sh`. It pulls, rebuilds, restarts, and runs new migrations.
Your data (database, avatars, synced subtitles) lives in Docker volumes and is not touched.

## Candy Resolver

Put `RESOLVER_URL` and `RESOLVER_API_KEY` in `backend/.env.prod`. With the site on a real domain you can keep
`RESOLVER_STREAM_MODE=proxy` (works with no extra setup), or switch to `direct` once CORS on the resolver allows
`https://<your domain>`. Subtitle sync needs ffmpeg, which is already in the backend image.

## Logs, backups, restore

- Logs: `docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend`
- Backup the database: 
  `docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db pg_dump -U candyflix candyflix | gzip > candyflix-$(date +%F).sql.gz`
- Restore (empty database): 
  `gunzip -c candyflix-DATE.sql.gz | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U candyflix candyflix`
- Profile pictures live in the `avatars` volume; they are small, but include them in server snapshots.

## Notes

- Only Caddy is public. Postgres, Redis, the backend and the site are on the private Docker network.
- Same address for the site and the API (`/api`), so there are no CORS settings to manage.
- Sessions use secure cookies in production, so the site must be reached over `https://`.
