#!/bin/sh
# Backend 容器启动 entrypoint：
#   1. 跑 DB migrations（goose up）
#   2. exec server
#
# MIGRATE_ON_START=false 给 ops 一个逃生口（设计稿 G.3）。

set -e

if [ "${MIGRATE_ON_START:-true}" = "true" ] && [ -d /app/db/migrations ]; then
  echo "[entrypoint] running goose up..."
  /app/goose -dir /app/db/migrations postgres "$DATABASE_URL" up
fi

exec /app/standmeet
