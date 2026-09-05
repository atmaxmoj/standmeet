#!/usr/bin/env bash
# backup.sh —— dump Postgres + tar named volumes into one .tar.gz.
#
# Usage:
#   ./backup.sh /var/backups/standmeet
# Output:
#   /var/backups/standmeet/standmeet-YYYYMMDD-HHMMSS.tar.gz
#
# Contents:
#   pg.dump           ← pg_dumpall sql
#   microsites.tar  ← contents of the /srv/microsites shared volume (owner microsite dist)
#   caddy_data.tar    ← Caddy issued certificates + ACME account (no re-signing after restore)
#
# Redis is not backed up: session / cache are discardable; losing them only kicks users out once.

set -euo pipefail

DEST_DIR="${1:-./backups}"
mkdir -p "$DEST_DIR"
TS=$(date -u +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "[backup] dumping postgres ..."
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dumpall -U standmeet > "$WORK/pg.dump"

echo "[backup] tarring microsites ..."
docker run --rm \
  -v standmeet_microsites_data:/src:ro \
  -v "$WORK:/out" \
  alpine sh -c 'tar -C /src -czf /out/microsites.tar.gz .'

echo "[backup] tarring caddy_data ..."
docker run --rm \
  -v standmeet_caddy_data:/src:ro \
  -v "$WORK:/out" \
  alpine sh -c 'tar -C /src -czf /out/caddy_data.tar.gz .' || true

OUT="$DEST_DIR/standmeet-$TS.tar.gz"
tar -C "$WORK" -czf "$OUT" .
echo "[backup] done → $OUT"
