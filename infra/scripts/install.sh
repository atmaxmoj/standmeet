#!/usr/bin/env bash
# install.sh —— one-line bring-up script for self-hosting StandMeet.
#
# Usage (on the owner's own server):
#   curl -fsSL https://standmeet.example.com/install.sh | PUBLIC_URL=https://me.example.com bash
# Or locally:
#   PUBLIC_URL=https://me.example.com ./install.sh
#
# It does:
#   1. check docker / compose
#   2. generate .env (POSTGRES_PASSWORD + SESSION_KEY random strings)
#   3. docker compose up -d
#   4. tail the backend log for the setup URL, print it to the owner

set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-}"
INFERENCE_PROVIDER="${INFERENCE_PROVIDER:-anthropic}"
INFERENCE_ANTHROPIC_KEY="${INFERENCE_ANTHROPIC_KEY:-}"

if [ -z "$PUBLIC_URL" ]; then
  echo "PUBLIC_URL is required. Example: PUBLIC_URL=https://me.example.com ./install.sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose v2 is required (docker compose, not docker-compose)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  PG_PASS=$(openssl rand -base64 24 | tr -d '\n/=+')
  SESS_KEY=$(openssl rand -base64 48 | tr -d '\n/=+')
  cat > .env <<EOF
PUBLIC_URL=$PUBLIC_URL
POSTGRES_PASSWORD=$PG_PASS
SESSION_KEY=$SESS_KEY
INFERENCE_PROVIDER=$INFERENCE_PROVIDER
INFERENCE_ANTHROPIC_KEY=$INFERENCE_ANTHROPIC_KEY
EOF
  echo "generated .env (POSTGRES_PASSWORD + SESSION_KEY rotated)"
fi

echo "[install] building + bringing up stack ..."
docker compose -f docker-compose.prod.yml up -d --build

echo "[install] waiting for backend healthy ..."
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml exec -T backend wget -qO- http://127.0.0.1:8000/internal/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[install] tailing backend log for setup URL ..."
SETUP_LINE=$(docker compose -f docker-compose.prod.yml logs backend --no-color --since 60s | grep -m1 "setup?t=") || true
if [ -z "$SETUP_LINE" ]; then
  echo "[install] no setup URL found in logs (already claimed?). Visit $PUBLIC_URL/login instead." >&2
else
  TOKEN=$(echo "$SETUP_LINE" | grep -oE 'setup\?t=[A-Za-z0-9_-]+' | head -1)
  echo ""
  echo "================================================================="
  echo "  Open this URL in your browser to claim the instance:"
  echo ""
  echo "      $PUBLIC_URL/$TOKEN"
  echo ""
  echo "================================================================="
fi
