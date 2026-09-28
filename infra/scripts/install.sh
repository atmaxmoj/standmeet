#!/usr/bin/env bash
# install.sh —— bring up StandMeet on a fresh host, from the released images.
#
#   curl -fsSL https://raw.githubusercontent.com/atmaxmoj/standmeet/main/infra/scripts/install.sh \
#     | bash -s -- --domain me.example.com
#
#   --domain D        serve https://D through a bundled Caddy, which gets its own Let's Encrypt
#                     certificate. Point D's DNS at this host and open ports 80 and 443 first.
#   (no --domain)     publish the app on port 3000 (STANDMEET_HTTP_PORT) for a proxy you run.
#   --dir PATH        where the stack lives (default ~/standmeet).
#   --internal-certs  use Caddy's own CA instead of Let's Encrypt (tests only).
#
# It downloads the compose files, writes .env with freshly generated secrets, pulls, starts, waits
# until healthy, and prints the one-time link that claims the instance. Re-running it upgrades the
# files and restarts the stack; an existing .env is kept, so the secrets never change
# (INSTANCE_SECRET encrypts stored credentials — a new one would orphan them).
#
# Pattern from PostHog's deploy-hobby (Caddy in front, .env written only once) and Plausible
# Community Edition (the compose files are the product; the script only fills them in).

set -euo pipefail

SOURCE="${STANDMEET_SOURCE:-https://raw.githubusercontent.com/atmaxmoj/standmeet/main/infra/deploy}"
DIR="${STANDMEET_DIR:-$HOME/standmeet}"
DOMAIN=""
CADDY_FLAGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --dir) DIR="${2:?--dir needs a value}"; shift 2 ;;
    --internal-certs) CADDY_FLAGS="--internal-certs"; shift ;;
    -h|--help)
      echo "usage: install.sh [--domain D] [--dir PATH] [--internal-certs]"
      echo "  --domain D   serve https://D via a bundled Caddy (Let's Encrypt); without it the app is on port 3000"
      exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 is required: $2" >&2; exit 1; }; }
need docker "install Docker first — https://docs.docker.com/engine/install/"
need openssl "used to generate the secrets"
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (the 'docker compose' command)." >&2; exit 1; }

mkdir -p "$DIR"
cd "$DIR"

fetch() {
  if [ -d "$SOURCE" ]; then cp "$SOURCE/$1" "$1"; else curl -fsSL "$SOURCE/$1" -o "$1"; fi
}
fetch docker-compose.yml
if [ -n "$DOMAIN" ]; then
  OVERLAY=compose.caddy.yml
  URL="https://$DOMAIN"
else
  OVERLAY=compose.port.yml
  # The app's own URL is only used by the PDF renderer, which fetches it from inside the stack.
  URL="http://app:3000"
fi
fetch "$OVERLAY"

secret() { openssl rand -hex "$1"; }
if [ -f .env ]; then
  echo "Keeping the existing .env (secrets are never regenerated)."
else
  umask 077
  cat > .env <<EOF
# Written once by install.sh. Back this file up: INSTANCE_SECRET encrypts stored credentials.
COMPOSE_FILE=docker-compose.yml:$OVERLAY
SERVICE_PASSWORD_POSTGRES=$(secret 24)
SERVICE_PASSWORD_64_SESSION=$(secret 32)
SERVICE_PASSWORD_64_INSTANCE=$(secret 32)
SERVICE_PASSWORD_64_MINIO=$(secret 32)
SERVICE_PASSWORD_MEILI=$(secret 24)
SERVICE_URL_APP=$URL
STANDMEET_DOMAIN=$DOMAIN
CADDY_EXTRA_FLAGS=$CADDY_FLAGS
EOF
  echo "Wrote $DIR/.env with new secrets."
fi

echo "Pulling images and starting (the first time takes a few minutes) ..."
docker compose pull --quiet
docker compose up -d --wait --wait-timeout 600

CLAIM=$(docker compose exec -T backend cat /srv/first-run.txt 2>/dev/null | tr -d '\r\n' || true)
SAVED_DOMAIN=$(grep '^STANDMEET_DOMAIN=' .env | cut -d= -f2-)
if [ -n "$SAVED_DOMAIN" ]; then
  BASE="https://$SAVED_DOMAIN"
else
  ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || true)  # a hint only; busybox has no -I
  BASE="http://${ADDR:-<this-server>}:${STANDMEET_HTTP_PORT:-3000}"
fi
echo
if [ -n "$CLAIM" ]; then
  echo "StandMeet is up. Open this link to claim it — it works once:"
  echo
  echo "    $BASE$CLAIM"
else
  echo "StandMeet is up and already claimed. Sign in at $BASE/login"
fi
echo
echo "Stack: $DIR  ·  logs: cd $DIR && docker compose logs -f  ·  upgrade: the admin panel, or re-run this script"
