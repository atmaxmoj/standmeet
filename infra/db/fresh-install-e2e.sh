#!/usr/bin/env bash
# fresh-install-e2e.sh — a REAL first-ever install of the StandMeet stack must boot.
#
# The backend applies its embedded migrations on top of schema.sql the first time it starts. If any
# migration references something that a FRESH database doesn't have yet, the backend crash-loops and
# the instance never comes up. That class of bug hides behind persistent dev volumes + incrementally
# migrated prod — nobody boots a truly fresh current DB — until someone installs from scratch. F-B-11:
# migration 2026-08-21-booking-subject.sql touched mcp_calendar_book.records, a capability's OWN
# capstore table created at runtime, so a fresh install crash-looped on first boot.
#
# This brings up the actual backend on a brand-new pgvector volume (schema.sql seeded via initdb.d,
# exactly like the dev/release db) + redis + minio, and asserts /api/v1/instance actually serves —
# the receipt that schema.sql + every migration apply cleanly on a first install. Run via
# `make fresh-install-e2e`. Needs Docker + network. Heavy (builds the backend); not in the lint chain.
set -euo pipefail

PROJECT=sm-fresh-install-e2e
IMG="${IMG:-standmeet-backend:fresh-e2e}"
PORT=18001
SECRET="fresh-e2e-test-only-not-a-real-instance-secret"   # ≥32 chars — INSTANCE_SECRET refuses shorter.
work="$(mktemp -d)"
COMPOSE="$work/compose.yml"
SCHEMA="$(pwd)/backend/db/schema.sql"

log() { echo "[fresh-install-e2e] $*"; }
dc()  { docker compose -p "$PROJECT" -f "$COMPOSE" "$@"; }
version() { curl -fsS -m 5 "http://localhost:$PORT/api/v1/instance" 2>/dev/null \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true; }

cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

log "building the current backend"
docker build -q -f backend/Dockerfile --target production \
  --build-arg STANDMEET_VERSION=fresh-e2e -t "$IMG" . >/dev/null

cat > "$COMPOSE" <<YML
name: $PROJECT
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_DB=standmeet
      - POSTGRES_USER=standmeet
      - POSTGRES_PASSWORD=$SECRET
    volumes:
      - dbdata:/var/lib/postgresql/data
      # schema.sql seeded on first init, exactly like the dev/release db — the base the migrations
      # are incremental on top of.
      - $SCHEMA:/docker-entrypoint-initdb.d/01-schema.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U standmeet -d standmeet"]
      interval: 3s
      timeout: 3s
      retries: 30
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 10
  minio:
    image: minio/minio:RELEASE.2025-04-08T15-41-24Z
    command: ["server", "/data"]
    environment:
      - MINIO_ROOT_USER=standmeet
      - MINIO_ROOT_PASSWORD=$SECRET
  backend:
    image: $IMG
    restart: unless-stopped
    environment:
      - HOST=0.0.0.0
      - PORT=8000
      - DATABASE_URL=postgres://standmeet:$SECRET@db:5432/standmeet?sslmode=disable
      - REDIS_URL=redis://redis:6379/0
      - SESSION_KEY=$SECRET$SECRET
      - INSTANCE_SECRET=$SECRET
      - STORAGE_ENDPOINT=minio:9000
      - STORAGE_ACCESS_KEY=standmeet
      - STORAGE_SECRET_KEY=$SECRET
      - STORAGE_BUCKET=standmeet
      - STORAGE_USE_SSL=false
      - STORAGE_PUBLIC_URL=http://localhost:9000
      - SECURE_COOKIE=false
    ports:
      - "$PORT:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_started
volumes:
  dbdata: {}
YML

log "up on a brand-new volume — the backend must apply schema.sql + every migration and serve"
dc up -d >/dev/null
i=0
while [ "$i" -lt 60 ]; do [ -n "$(version)" ] && break; sleep 2; i=$((i + 1)); done
v="$(version)"
if [ -z "$v" ]; then
  log "FAIL: a fresh install never served /api/v1/instance — a migration likely crash-loops on boot"
  dc logs backend | tail -30
  exit 1
fi
log "PASS: fresh install booted and serves (version=$v) — schema.sql + every migration applied clean"
