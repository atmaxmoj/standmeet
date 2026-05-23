#!/bin/sh
# Backend 容器启动 entrypoint：直接 exec server。
#
# Schema 在 db service fresh volume 启动时由 postgres image 应用
# (/docker-entrypoint-initdb.d/01-schema.sql 挂载 backend/db/schema.sql)。
# 全新软件、未发布、没有 migration 演进——schema 变化的姿势是重建 db
# volume (`make clean && make dev`)。

set -e
exec /app/standmeet
