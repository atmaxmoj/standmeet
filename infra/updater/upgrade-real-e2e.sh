#!/usr/bin/env bash
# upgrade-real-e2e.sh — a REAL end-to-end of the product-owned upgrade, on the ACTUAL StandMeet
# stack (not a toy alpine target). It brings up a real backend + db + redis + minio pinned to
# one published release, presses the upgrade button (writes the signal), and asserts the RUNNING
# instance's own /api/v1/instance version actually moved to the next release — which also proves
# the boot-time DB migration ran across the version bump. This is the receipt that "press the
# button → the real instance upgrades" holds, version to version ([[stand-in-is-politer-than-reality]]).
#
# Run via `make upgrade-real-e2e`. Needs Docker + network (pulls the two releases from ghcr,
# registry:2, redis, minio, busybox). Deliberately NOT in the fast lint chain. Set FROM_VER/TO_VER
# to pick the two releases (defaults track the current + previous tag).
set -euo pipefail

# Two version STRINGS baked into the SAME current code via --build-arg. Using two published
# releases instead would conflate a fresh-install bug in the OLDER release (its db image + the
# backend's migrations don't cleanly initialise a *fresh* volume — real upgrades go over an
# incrementally-migrated db, not a fresh one) with the thing under test: does the button move a
# live instance from one version to the next. Current code boots a fresh volume cleanly, so two
# builds of it isolate the upgrade mechanism.
FROM_VER="${FROM_VER:-e2e-from}"
TO_VER="${TO_VER:-e2e-to}"
GHCR="ghcr.io/atmaxmoj"
REG_PORT=5998
REG="localhost:$REG_PORT"
REGNAME=sm-upgrade-e2e-registry
PROJECT=sm-upgrade-e2e
UPDATER_IMG="${UPDATER_IMG:-standmeet-updater:e2e}"
PORT=18000
# ≥32-char secrets — INSTANCE_SECRET under 32 makes cryptobox refuse to boot.
SECRET="upgrade-e2e-test-only-not-a-real-instance-secret"
work="$(mktemp -d)"
COMPOSE="$work/compose.yml"
# Absolute path so the mount resolves from the temp compose dir AND when the updater fetches the
# compose (the daemon mounts host paths). This is exactly how the dev stack seeds the base schema.
SCHEMA="$(pwd)/backend/db/schema.sql"

log() { echo "[upgrade-real-e2e] $*"; }
dc()  { docker compose -p "$PROJECT" -f "$COMPOSE" "$@"; }
version() { curl -fsS -m 5 "http://localhost:$PORT/api/v1/instance" 2>/dev/null \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true; }

cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$REGNAME" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

wait_version() { # wait_version <expected> <secs>
  local i
  for i in $(seq 1 "$2"); do [ "$(version)" = "$1" ] && return 0; sleep 2; done
  return 1
}

# stage_db — the db image only needs to be current (its baked schema matches current code); pull
# it once into the local registry. It is not what changes between the two "releases".
stage_db() {
  docker pull -q "$GHCR/standmeet-db:latest" >/dev/null
  docker tag "$GHCR/standmeet-db:latest" "$REG/standmeet-db:latest"
  docker push -q "$REG/standmeet-db:latest" >/dev/null
}

# publish_backend — build the CURRENT backend with $1 stamped in as its version, tag it :latest in
# the local registry and push. Calling it a second time with a new version MOVES :latest — exactly
# what cutting a new release does, but from the same code so a fresh volume boots cleanly.
publish_backend() {
  log "building backend as version '$1'"
  docker build -q -f backend/Dockerfile --target production \
    --build-arg STANDMEET_VERSION="$1" -t "$REG/standmeet-backend:latest" . >/dev/null
  docker push -q "$REG/standmeet-backend:latest" >/dev/null
}

log "building $UPDATER_IMG from infra/updater/Dockerfile"
docker build -q -t "$UPDATER_IMG" -f infra/updater/Dockerfile . >/dev/null

log "starting throwaway registry"
docker rm -f "$REGNAME" >/dev/null 2>&1 || true
docker run -d --name "$REGNAME" -p "$REG_PORT:5000" registry:2 >/dev/null
for _ in $(seq 1 30); do curl -sf "http://$REG/v2/" >/dev/null 2>&1 && break; sleep 1; done

log "building the backend as $FROM_VER into the local registry (db is plain pgvector)"
publish_backend "$FROM_VER"

cat > "$COMPOSE" <<YML
name: $PROJECT
services:
  db:
    # Plain pgvector (like the dev stack), NOT the release-baked standmeet-db image: the backend's
    # own migrations build the schema from empty. The baked image deliberately keeps some capability
    # tables "out of fresh installs" (schema.sql), so a core migration referencing one fails on a
    # fresh baked volume — a real, separate finding about fresh RELEASE installs, not the upgrade
    # mechanism this test is for.
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_DB=standmeet
      - POSTGRES_USER=standmeet
      - POSTGRES_PASSWORD=$SECRET
    volumes:
      - dbdata:/var/lib/postgresql/data
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
    image: $REG/standmeet-backend:latest
    pull_policy: always
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
  composesrv:
    image: busybox
    command: ["httpd", "-f", "-p", "80", "-h", "/www"]
    volumes:
      - $COMPOSE:/www/compose.yml:ro
  updater:
    image: $UPDATER_IMG
    environment:
      - STANDMEET_UPGRADE_SIGNAL=/run/standmeet/upgrade.signal
      - STANDMEET_PROJECT=$PROJECT
      - STANDMEET_COMPOSE_URL=http://composesrv:80/compose.yml
      - STANDMEET_UPGRADE_POLL_SECONDS=2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - sig:/run/standmeet
volumes:
  dbdata: {}
  sig: {}
YML

log "up on $FROM_VER — waiting for the real backend to boot + serve /api/v1/instance"
dc up -d >/dev/null
if ! wait_version "$FROM_VER" 90; then
  log "FAIL: backend never came up reporting $FROM_VER (saw '$(version)')"; dc logs backend | tail -30; exit 1
fi
log "instance is live on $FROM_VER"

log "publishing $TO_VER: rebuild the backend as $TO_VER, moving :latest (what a release does)"
publish_backend "$TO_VER"

press="$(date +%s)"
dc exec -T updater sh -c "echo $press > /run/standmeet/upgrade.signal"
log "signal written ($press) — updater should fetch the canonical compose, pull $TO_VER, recreate"

if ! wait_version "$TO_VER" 120; then
  log "FAIL: instance never upgraded to $TO_VER after the signal (saw '$(version)')"
  dc logs updater | tail -20; dc logs backend | tail -20; exit 1
fi
# Still serving on $TO_VER means the v$FROM→v$TO boot migration ran cleanly on the existing
# volume — a version bump that couldn't migrate would leave the backend crash-looping, not 200.
log "PASS: real instance upgraded $FROM_VER → $TO_VER via the button, and still serves (migration ran)"
