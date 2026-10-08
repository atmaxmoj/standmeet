#!/bin/sh
# Builder entrypoint —— hand the dirs it writes to the unprivileged user, then run as that user.
#
# The builder runs the owner's code (vite, and the prerender executes the page). It ran as root
# (refactor ledger R20). It now runs as `standmeet` (uid 1001, the backend's uid: both share
# microsites_data, so one owner for its files).
#
# Starting as root for one step is for instances that already exist: their microsites_data
# volume holds root-owned builds from the root builder, and an unprivileged builder could not
# write next to them. Only files not yet owned are changed, so this costs nothing after the
# first start. The compose files drop every capability except the three this step needs; the
# server itself, after su-exec, holds none.

set -e
for d in /srv/microsites /tmp/work; do
  find "$d" ! -user standmeet -exec chown standmeet:standmeet {} + 2>/dev/null || true
done
exec su-exec standmeet node /opt/builder/runner.mjs
