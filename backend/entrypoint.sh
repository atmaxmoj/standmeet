#!/bin/sh
# Backend 容器启动 entrypoint：
#   1. 跑 DB migrations（M2 起，用 goose；M1 是 no-op）
#   2. exec server
#
# 把 migrations 放在 exec 之前确保 server 起来时 schema 已就绪。
# MIGRATE_ON_START=false 给 ops 一个逃生口（设计稿 G.3）。

set -e

if [ "${MIGRATE_ON_START:-true}" = "true" ] && [ -d /app/db/migrations ]; then
  if ls /app/db/migrations/*.sql >/dev/null 2>&1; then
    echo "[entrypoint] running migrations..."
    # M1 还没引入 goose；M2 起 uncomment 下行：
    # goose -dir /app/db/migrations postgres "$DATABASE_URL" up
    echo "[entrypoint] (placeholder — no migrations to run yet)"
  fi
fi

exec /app/standmeet
