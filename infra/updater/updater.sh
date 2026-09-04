#!/bin/sh
# updater.sh — the DOCKER upgrade adapter for the product-owned upgrade.
#
# Ownership boundary (the whole point):
#   - The PRODUCT (backend) never touches docker and never knows how it's deployed. When the
#     owner presses "upgrade" it emits ONE substrate-blind pulse: a fresh timestamp on a file
#     it shares with whatever adapter the deployment bound.
#   - THIS worker is the *docker substrate's* adapter — one of potentially many (a k8s or a
#     bare-git deployment would bind a different adapter to the same pulse). The product does
#     not know this adapter exists, or that it's docker.
#   - So this file is allowed to know docker. It is NOT allowed to bind to one specific
#     deployment's LOCAL compose — that couples the upgrade to how *this* instance happened to
#     be laid down.
#
# Following Coolify's own self-upgrade: it fetches the **canonical** compose from the release
# (STANDMEET_COMPOSE_URL), not a mounted local file. So an upgrade always applies the
# authoritative deployment definition — and can change the stack's *shape*, not just bump image
# tags. Secrets stay local: the existing .env is passed through; only the compose STRUCTURE is
# fetched. All host privilege lives here, off the internet-facing surface ([[product-owned-upgrade]]).
set -eu

SIGNAL="${STANDMEET_UPGRADE_SIGNAL:?STANDMEET_UPGRADE_SIGNAL must be set}"
PROJECT="${STANDMEET_PROJECT:-standmeet}"
COMPOSE_URL="${STANDMEET_COMPOSE_URL:?STANDMEET_COMPOSE_URL must be set (the canonical compose)}"
ENV_FILE="${STANDMEET_UPGRADE_ENV_FILE:-/srv/env/.env}"
POLL="${STANDMEET_UPGRADE_POLL_SECONDS:-5}"
# SELF — this sidecar's own service name, excluded from the recreate below.
SELF="${STANDMEET_UPDATER_SERVICE:-updater}"

log() { echo "[updater] $*"; }

# fetch_compose — download the canonical compose to $1. Coolify fetches from its CDN; we fetch
# from the release. Failing to fetch aborts THIS upgrade, leaving the running stack untouched.
fetch_compose() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$COMPOSE_URL" -o "$1"
  else
    wget -q -O "$1" "$COMPOSE_URL"
  fi
}

# dc — docker compose against the FETCHED canonical compose, scoped to this project by -p, with
# the local .env passed through if present (secrets stay local; only structure was fetched).
dc() {
  _compose="$1"
  shift
  if [ -f "$ENV_FILE" ]; then
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$_compose" "$@"
  else
    docker compose -p "$PROJECT" -f "$_compose" "$@"
  fi
}

# upgrade — fetch the canonical compose, pull the images it points at, recreate the changed
# services. Recreates **every service except this updater itself**: `up -d` recreating the
# updater would kill the very process running the command mid-upgrade (a real e2e proved this
# is fatal). A new updater image is picked up on the next full stack restart.
upgrade() {
  log "signal received — fetching canonical compose from $COMPOSE_URL"
  _c="$(mktemp)"
  if ! fetch_compose "$_c"; then
    log "could not fetch the canonical compose — leaving the running stack untouched"
    rm -f "$_c"
    return 1
  fi
  others="$(dc "$_c" config --services | grep -vx "$SELF" | tr '\n' ' ')"
  log "pulling newest images (project=$PROJECT, excluding self=$SELF)"
  # shellcheck disable=SC2086  # deliberate word-splitting: pass each service as its own arg.
  dc "$_c" pull $others
  log "recreating services"
  # shellcheck disable=SC2086
  dc "$_c" up -d $others
  rm -f "$_c"
  log "upgrade complete"
}

# Seed `last` with the signal's current content, so a restart of this worker does NOT re-run an
# upgrade that already happened — only a *change* (a new press writes a new timestamp) triggers
# one, exactly once per press.
last=""
[ -f "$SIGNAL" ] && last="$(cat "$SIGNAL")"
log "watching $SIGNAL every ${POLL}s (project=$PROJECT)"

# watch_once — one tick: act only when the signal's content changed since the last tick. A test
# drives this directly with a fake docker + a stub compose URL; the loop below is just the clock.
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
