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
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
