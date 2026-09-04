#!/bin/sh
# updater.sh — the product-owned upgrade worker.
#
# The upgrade button on /admin/system used to need the owner to paste an orchestrator webhook
# URL, which most self-hosters can't produce, so the button was dead by default. This worker
# removes that requirement. It watches STANDMEET_UPGRADE_SIGNAL — a file on the volume it
# shares with the backend. The backend writes a fresh timestamp there when the owner presses
# "upgrade"; this worker — the only container with docker access — pulls the newest images and
# recreates the stack.
#
# The backend never touches docker.sock: it writes one byte to a file. All host privilege
# lives here, in one small, single-purpose container off the internet-facing surface
# ([[product-owned-upgrade]]).
set -eu

SIGNAL="${STANDMEET_UPGRADE_SIGNAL:?STANDMEET_UPGRADE_SIGNAL must be set}"
PROJECT="${STANDMEET_PROJECT:-standmeet}"
COMPOSE_FILE="${STANDMEET_COMPOSE_FILE:-/srv/compose/docker-compose.yml}"
POLL="${STANDMEET_UPGRADE_POLL_SECONDS:-5}"
# SELF — this sidecar's own service name, excluded from the recreate below.
SELF="${STANDMEET_UPDATER_SERVICE:-updater}"

log() { echo "[updater] $*"; }

# upgrade — pull the newest images the compose points at, then recreate the changed services.
# Scoped to this project by -p, so on a shared host it touches only this stack. Separated from
# the watch loop so the loop's logic can be exercised without a real docker daemon.
#
# Crucially it recreates **every service except this updater itself**: `up -d` recreating the
# updater would kill the very process running the command mid-upgrade (a real e2e proved this is
# fatal, not theoretical). The updater image is small and stable; a new one is picked up on the
# next full stack restart. Excluding self also means a service whose image can't be pulled (like
# this updater when it isn't in a registry) doesn't abort the others.
upgrade() {
  log "signal received — pulling newest images (project=$PROJECT, excluding self=$SELF)"
  others="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config --services \
    | grep -vx "$SELF" | tr '\n' ' ')"
  # shellcheck disable=SC2086  # deliberate word-splitting: pass each service as its own arg.
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" pull $others
  log "recreating services"
  # shellcheck disable=SC2086
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d $others
  log "upgrade complete"
}

# Seed `last` with the signal's current content, so a restart of this worker does NOT re-run an
# upgrade that already happened — only a *change* (a new press writes a new timestamp) triggers
# one, exactly once per press.
last=""
[ -f "$SIGNAL" ] && last="$(cat "$SIGNAL")"
log "watching $SIGNAL every ${POLL}s (project=$PROJECT, compose=$COMPOSE_FILE)"

# watch_once — one tick: act only when the signal's content changed since the last tick. A test
# drives this directly with a fake docker on PATH; the loop below is just the clock around it.
watch_once() {
  [ -f "$SIGNAL" ] || return 0
  cur="$(cat "$SIGNAL")"
  [ "$cur" = "$last" ] && return 0
  last="$cur"
  upgrade || log "upgrade failed — will retry on the next press"
}

# ponytail: mtime/content poll, not inotify — docker:cli has no inotify-tools, and a 5s poll on
# a button press is plenty. Add inotify only if sub-second latency ever matters.
if [ "${STANDMEET_UPDATER_ONESHOT:-}" = "1" ]; then
  watch_once
  exit 0
fi
while true; do
  watch_once
  sleep "$POLL"
done
