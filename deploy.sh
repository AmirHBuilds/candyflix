#!/bin/sh
# Update the VPS to the latest code and restart. Run from the project folder on the server:  ./deploy.sh
# Safe to run any time: database migrations run on start, data lives in Docker volumes.
set -e
cd "$(dirname "$0")"
[ -f .env.prod ] || { echo "Missing .env.prod (copy .env.prod.example)"; exit 1; }
[ -f backend/.env.prod ] || { echo "Missing backend/.env.prod (copy backend/.env.prod.example)"; exit 1; }
if [ -d .git ]; then git pull --ff-only; fi
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker image prune -f >/dev/null
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
