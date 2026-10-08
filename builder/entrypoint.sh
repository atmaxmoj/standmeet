#!/bin/sh
# Builder entrypoint —— hand the shared volume to its owner, then start the daemon.
#
# Two users (builder/Dockerfile). The output volume belongs to `standmeet` (uid 1001, the backend's,
# which serves and purges it). The owner's code — vite and the prerender, which executes the page —
# runs as `sm-build` (uid 1002): runner.mjs spawns those children with that uid, and the kernel
# clears every capability on the switch away from root. So one page's build-time code cannot write
# another page's published files (microsite-builder-isolation.spec.ts).
#
# The daemon itself stays root to do that switch, holding only what compose grants it: CHOWN (hand a
# work dir to sm-build, a finished build to standmeet), SETUID / SETGID (spawn as sm-build), and
# DAC_OVERRIDE (write a finished build into standmeet's volume). It ran as uid 1001 before (R20),
# which shared the volume with the owner's code.
#
# The fix-up below is for instances that already exist: their volume may hold root-owned builds
# from older builders. Only files not yet owned are changed, so this costs nothing after the first
# start.

set -e
find /srv/microsites ! -user standmeet -exec chown standmeet:standmeet {} + 2>/dev/null || true
exec node /opt/builder/runner.mjs
