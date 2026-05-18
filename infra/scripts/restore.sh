#!/usr/bin/env bash
# restore.sh —— 从 backup.sh 的 .tar.gz 恢复一个干净 instance。
#
# 用法：
#   ./restore.sh /var/backups/standmeet/standmeet-YYYYMMDD-HHMMSS.tar.gz
#
# 流程：
#   1. docker compose down -v   ← 清掉旧数据
#   2. 解 tar.gz 拿三件套：pg.dump、custom_pages.tar.gz、caddy_data.tar.gz
#   3. docker compose up -d db redis   ← 起依赖
#   4. psql 导入 pg.dump
#   5. 把 custom_pages / caddy_data 内容回灌到 named volume
#   6. docker compose up -d 全起
#
# 不恢复 Redis（设计：session 重新登）。

set -euo pipefail

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: $0 <standmeet-YYYYMMDD-HHMMSS.tar.gz>" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar -C "$WORK" -xzf "$ARCHIVE"

echo "[restore] tearing down old stack ..."
docker compose -f docker-compose.prod.yml down -v --remove-orphans 2>/dev/null || true

echo "[restore] bringing up db + redis ..."
docker compose -f docker-compose.prod.yml up -d db redis
sleep 5

echo "[restore] importing postgres dump ..."
docker compose -f docker-compose.prod.yml exec -T db psql -U standmeet -d standmeet < "$WORK/pg.dump"

echo "[restore] reloading custom_pages volume ..."
docker volume create standmeet_custom_pages_data >/dev/null
docker run --rm \
  -v standmeet_custom_pages_data:/dst \
  -v "$WORK:/src:ro" \
  alpine sh -c 'tar -C /dst -xzf /src/custom_pages.tar.gz'

if [ -f "$WORK/caddy_data.tar.gz" ]; then
  echo "[restore] reloading caddy_data ..."
  docker volume create standmeet_caddy_data >/dev/null
  docker run --rm \
    -v standmeet_caddy_data:/dst \
    -v "$WORK:/src:ro" \
    alpine sh -c 'tar -C /dst -xzf /src/caddy_data.tar.gz'
fi

echo "[restore] bringing up full stack ..."
docker compose -f docker-compose.prod.yml up -d --build

echo "[restore] done."
