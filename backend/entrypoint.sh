#!/bin/sh
set -e

# Applying migrations here (rather than expecting a human to run them
# manually) means `docker compose up` alone always leaves the database
# schema in sync with the code — no separate "don't forget to migrate"
# step to miss. `alembic upgrade head` is idempotent: if the schema is
# already current, this is a fast no-op.
echo "Running database migrations..."
alembic upgrade head

echo "Starting CandyFlix backend..."
if [ "$ENVIRONMENT" = "production" ]; then
  # Production: no auto-reload. The backend sits behind the Caddy proxy, so trust its X-Forwarded-* headers
  # (the real visitor address shows in the sign-in log and rate limits).
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" --workers "${WEB_CONCURRENCY:-1}"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
