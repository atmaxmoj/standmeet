#!/usr/bin/env bash
# updater-e2e.sh — a REAL end-to-end test of the product-owned upgrade. No fakes: a live local
# registry, a live stack, a genuine image bump on the :latest tag, a genuine signal, and an
# assertion that the RUNNING container actually became the newer version — then that a repeat
# press does NOT needlessly recreate it. This is the receipt that "press the button → the
# instance upgrades" actually holds, end to end ([[stand-in-is-politer-than-reality]]).
#
# Run via `make updater-e2e`. Needs a working Docker daemon + network (pulls registry:2 and two
# alpine tags). It is deliberately NOT in the fast lint chain.
set -euo pipefail

REG_PORT=5999
REG="localhost:$REG_PORT"
REGNAME=sm-updater-e2e-registry
PROJECT=sm-updater-e2e
IMG="$REG/target"
UPDATER_IMG="${UPDATER_IMG:-standmeet-updater:e2e}"
V1=3.18
V2=3.19
work="$(mktemp -d)"
COMPOSE="$work/compose.yml"

log() { echo "[updater-e2e] $*"; }
dc()  { docker compose -p "$PROJECT" -f "$COMPOSE" "$@"; }

cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$REGNAME" >/dev/null 2>&1 || true
  docker rmi "$IMG:latest" "$UPDATER_IMG" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# target_release — the alpine release string the running target container reports. Tied to the
# IMAGE, so pulling a moved :latest genuinely changes it.
target_release() { dc logs target 2>/dev/null | grep -oE '3\.[0-9]+' | head -1 || true; }
target_cid()     { dc ps -q target 2>/dev/null | head -1; }

wait_for() { # wait_for <what> <getter> <expected> <secs>
  local i
  for i in $(seq 1 "$4"); do [ "$($2)" = "$3" ] && return 0; sleep 1; done
  return 1
}

# ── 0. Build the updater image under test, from the real Dockerfile ─────────────────────────
log "building $UPDATER_IMG from infra/updater/Dockerfile"
docker build -q -t "$UPDATER_IMG" -f infra/updater/Dockerfile . >/dev/null

# ── 1. A throwaway local registry, so `docker compose pull` has a real place to pull from ────
docker rm -f "$REGNAME" >/dev/null 2>&1 || true
docker run -d --name "$REGNAME" -p "$REG_PORT:5000" registry:2 >/dev/null
for i in $(seq 1 30); do curl -sf "http://$REG/v2/" >/dev/null 2>&1 && break; sleep 1; done

# ── 2. Publish v1 (alpine $V1) as :latest ───────────────────────────────────────────────────
docker pull -q "alpine:$V1" >/dev/null
docker tag "alpine:$V1" "$IMG:latest"
docker push -q "$IMG:latest" >/dev/null

# ── 3. Bring up the stack: a target on :latest + the updater watching the signal ────────────
cat > "$COMPOSE" <<YML
name: $PROJECT
services:
  target:
    image: $IMG:latest
    command: ["sh","-c","cat /etc/alpine-release; sleep 3600"]
    pull_policy: always
  updater:
    image: $UPDATER_IMG
    environment:
      - STANDMEET_UPGRADE_SIGNAL=/run/standmeet/upgrade.signal
      - STANDMEET_PROJECT=$PROJECT
      - STANDMEET_COMPOSE_FILE=/srv/compose/compose.yml
      - STANDMEET_UPGRADE_POLL_SECONDS=2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - sig:/run/standmeet
      - $COMPOSE:/srv/compose/compose.yml:ro
volumes:
  sig: {}
YML

log "up (target should start as alpine $V1)"
dc up -d >/dev/null
wait_for "v1" target_release "$V1" 30 || { log "FAIL: target never started as $V1 (saw '$(target_release)')"; exit 1; }
cid_v1="$(target_cid)"
log "target running $V1 (container ${cid_v1:0:12})"

# ── 4. Move :latest to v2 (what the release does when it publishes a newer version) ─────────
docker pull -q "alpine:$V2" >/dev/null
docker tag "alpine:$V2" "$IMG:latest"
docker push -q "$IMG:latest" >/dev/null
log "moved :latest → alpine $V2"

# ── 5. Press the button: write a fresh signal into the shared volume (the backend's job) ────
press="$(date +%s)"
dc exec -T updater sh -c "echo $press > /run/standmeet/upgrade.signal"
log "signal written ($press); waiting for a real pull + recreate"

# ── 6. Assert the running target actually became v2 ─────────────────────────────────────────
if ! wait_for "v2" target_release "$V2" 60; then
  log "FAIL: target never upgraded to $V2 after the signal"; dc logs updater | tail -20; exit 1
fi
cid_v2="$(target_cid)"
[ "$cid_v2" != "$cid_v1" ] || { log "FAIL: reported $V2 but container id unchanged — not a real recreate"; exit 1; }
log "UPGRADED: target is now $V2 (container ${cid_v2:0:12}, was ${cid_v1:0:12})"

# ── 7. Idempotency: the SAME signal content again must NOT recreate the container ───────────
dc exec -T updater sh -c "echo $press > /run/standmeet/upgrade.signal"
sleep 8   # more than two poll intervals
cid_again="$(target_cid)"
[ "$cid_again" = "$cid_v2" ] || { log "FAIL: an unchanged signal recreated the container (id churned)"; exit 1; }
log "PASS: press -> real pull of moved :latest -> recreated $V1 to $V2; repeat press is a no-op"
