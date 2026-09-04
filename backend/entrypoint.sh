#!/bin/sh
# Backend container startup entrypoint: just exec the server.
#
# The schema is applied by the postgres image when the db service starts on a
# fresh volume (/docker-entrypoint-initdb.d/01-schema.sql mounts backend/db/schema.sql).
# Brand-new software, unreleased, no migration evolution yet — the way to change
# the schema is to rebuild the db volume (`make clean && make dev`).

set -e
exec /app/standmeet
