#!/usr/bin/env bash
# backup.sh —— dump Postgres + tar named volumes 到一个 .tar.gz。
#
# 用法：
#   ./backup.sh /var/backups/standmeet
# 产物：
#   /var/backups/standmeet/standmeet-YYYYMMDD-HHMMSS.tar.gz
#
# 内容：
#   pg.dump           ← pg_dumpall sql
#   custom_pages.tar  ← /srv/custom-pages 共享 volume 内容（owner R 自定义页 dist）
#   caddy_data.tar    ← Caddy 已签发证书 + ACME 账户（恢复后免重签）
#
# Redis 不备份：session / 缓存可丢弃；丢失只是用户被踢一次。

set -euo pipefail

DEST_DIR="${1:-./backups}"
mkdir -p "$DEST_DIR"
TS=$(date -u +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "[backup] dumping postgres ..."
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dumpall -U standmeet > "$WORK/pg.dump"

echo "[backup] tarring custom_pages ..."
docker run --rm \
  -v standmeet_custom_pages_data:/src:ro \
  -v "$WORK:/out" \
  alpine sh -c 'tar -C /src -czf /out/custom_pages.tar.gz .'

echo "[backup] tarring caddy_data ..."
docker run --rm \
  -v standmeet_caddy_data:/src:ro \
  -v "$WORK:/out" \
  alpine sh -c 'tar -C /src -czf /out/caddy_data.tar.gz .' || true

OUT="$DEST_DIR/standmeet-$TS.tar.gz"
tar -C "$WORK" -czf "$OUT" .
echo "[backup] done → $OUT"
