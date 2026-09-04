#!/usr/bin/env bash
# updater-e2e.sh — a REAL end-to-end for the product-owned updater, driving the exact failure the
# old test could never see.
#
# The OLD test handed the updater STANDMEET_PROJECT=<the same project> and the same compose it was
# fetching, so "discover the project name" and "adopt the existing volumes" were never exercised —
# it was rigged to pass. On a real deployment whose project name differs (e.g. any PaaS), the old
# updater built a PARALLEL empty stack instead of upgrading the real one, and no test caught it.
#
# This test does it honestly:
#   1. Bring up a real stack with `docker compose` (real project, a real named volume with data).
#   2. Deploy the updater AS PART of the stack and tell it NOTHING about the project — it must
#      discover it from its own container's compose label.
#   3. Write a UNIQUE marker into the volume, publish a v2 image, press the button.
#   4. Assert the service upgraded to v2 AND the marker survived (the original volume was adopted,
#      not replaced by a fresh one) AND no parallel container/volume appeared.
# The marker-survives + no-twin assertions are exactly what the old test lacked.
#
# Run via `make updater-e2e`. Needs Docker + network (registry:2, alpine).
set -euo pipefail

PROJECT=sm-updater-e2e
REG_PORT=5988
REG="localhost:$REG_PORT"
SVC="$REG/sm-e2e-svc"
UPDATER_IMG="${UPDATER_IMG:-standmeet-updater:e2e}"
REGNAME=sm-updater-e2e-registry
work="$(mktemp -d)"
COMPOSE="$work/compose.yml"

log() { echo "[updater-e2e] $*"; }
dc() { docker compose -p "$PROJECT" -f "$COMPOSE" "$@"; }
svc_cid() { dc ps -q svc; }
projvols() { docker volume ls -q | grep -c "^${PROJECT}_" || true; }
projcons() { docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | wc -l | tr -d ' '; }

cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$REGNAME" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# publish_svc <version> — build the tiny test service at $1 and MOVE :latest to it (what cutting a
# release does). The image bakes its version into /version and mounts a /data volume.
publish_svc() {
  d="$(mktemp -d)"
  printf 'FROM alpine:3.20\nARG VER\nRUN echo "$VER" > /version\nVOLUME /data\nCMD ["sleep","infinity"]\n' >"$d/Dockerfile"
  docker build -q --build-arg VER="$1" -t "$SVC:latest" "$d" >/dev/null
  docker push -q "$SVC:latest" >/dev/null
  rm -rf "$d"
}

log "building the updater under test ($UPDATER_IMG)"
docker build -q -t "$UPDATER_IMG" -f infra/updater/Dockerfile . >/dev/null

log "starting a throwaway registry"
docker rm -f "$REGNAME" >/dev/null 2>&1 || true
docker run -d --name "$REGNAME" -p "$REG_PORT:5000" registry:2 >/dev/null
for _ in $(seq 1 30); do curl -sf "http://$REG/v2/" >/dev/null 2>&1 && break; sleep 1; done

log "publishing v1 and bringing the stack up (updater is NOT told the project name)"
publish_svc v1
cat >"$COMPOSE" <<YML
name: $PROJECT
services:
  svc:
    image: $SVC:latest
    pull_policy: always
    command: ["sleep", "infinity"]
    volumes:
      - "data:/data"
  updater:
    image: $UPDATER_IMG
    environment:
      - STANDMEET_UPGRADE_SIGNAL=/run/standmeet/upgrade.signal
      - STANDMEET_IMAGE_PREFIX=$SVC
      - STANDMEET_CHANNEL=latest
      - STANDMEET_UPGRADE_POLL_SECONDS=2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - sig:/run/standmeet
volumes:
  data: {}
  sig: {}
YML
dc up -d >/dev/null
for _ in $(seq 1 15); do [ -n "$(svc_cid)" ] && break; sleep 1; done
[ "$(docker exec "$(svc_cid)" cat /version)" = "v1" ] || { log "FAIL: svc did not start on v1"; exit 1; }

MARK="marker-$(date +%s)-$RANDOM"
log "writing a unique marker into the volume: $MARK"
docker exec "$(svc_cid)" sh -c "echo $MARK > /data/marker"
vols_before="$(projvols)"
cons_before="$(projcons)"

log "publishing v2 (moves :latest) and pressing the button (writing the signal)"
publish_svc v2
dc exec -T updater sh -c "echo $(date +%s) > /run/standmeet/upgrade.signal"

log "waiting for svc to come back reporting v2"
ok=0
for _ in $(seq 1 40); do
  cid="$(svc_cid)"
  [ -n "$cid" ] && [ "$(docker exec "$cid" cat /version 2>/dev/null)" = "v2" ] && { ok=1; break; }
  sleep 2
done
[ "$ok" = 1 ] || { log "FAIL: svc never upgraded to v2"; dc logs updater | tail -20; exit 1; }

cid="$(svc_cid)"
got="$(docker exec "$cid" cat /data/marker 2>/dev/null || true)"
if [ "$got" != "$MARK" ]; then
  log "FAIL: data marker is '$got', expected '$MARK' — the updater built a FRESH volume instead of"
  log "      adopting the real one (the exact twin-stack bug this test exists to catch)."
  exit 1
fi
vols_after="$(projvols)"
cons_after="$(projcons)"
[ "$vols_after" = "$vols_before" ] || { log "FAIL: project volumes $vols_before -> $vols_after — a parallel stack appeared"; exit 1; }
[ "$cons_after" = "$cons_before" ] || { log "FAIL: project containers $cons_before -> $cons_after — a parallel stack appeared"; exit 1; }
[ "$(docker inspect "$cid" -f '{{index .Config.Labels "com.docker.compose.project"}}')" = "$PROJECT" ] \
  || { log "FAIL: upgraded container is not in project $PROJECT"; exit 1; }

log "PASS: v1 -> v2 in place; marker '$MARK' survived; no twin (updater discovered project=$PROJECT itself, no project name given)"
