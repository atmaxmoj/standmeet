#!/usr/bin/env bash
# check-periodic-via-scheduler.sh —— anything that runs on a timer is a periodic job, run by the
# job runtime (internal/infra/jobs).
#
# A domain declares what to do as data (periodic.Job, collected into jobs.Periodic by the
# composition root); the runtime owns how often, on which process (the elected leader), and the
# durable record of each run on the Tasks panel. A hand-written loop runs on every replica,
# forgets its history on restart, and never appears on the panel — the in-process scheduler this
# replaced, and three hand-written loops before it, all did exactly that.
#
# Rule: `time.NewTicker` / `time.Tick` may appear only in internal/infra/jobs/**.
# Design: docs/design/event-bus-outbox-webhooks.md, "Enforcement".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^internal/infra/jobs/'

# goFiles —— find, not `grep --include`: BusyBox grep (the alpine image lint) does not know that
# flag and exits with no output, which reads exactly like a clean tree.
goFiles() {
	find "$BK/internal" "$BK/cmd" "$BK/agentcore" -type f -name '*.go' 2>/dev/null |
		grep -v '_test\.go$' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-periodic-via-scheduler: scanned only $scanned Go files under $BK — the scan is blind, not the tree clean."
	exit 2
fi

fail=0

while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-periodic-via-scheduler: $rel starts its own timer —— declare a periodic.Job instead; the job runtime (internal/infra/jobs) runs it on the leader and records every run."
	fail=1
done < <(goFiles | xargs grep -lE 'time\.NewTicker|time\.Tick\(' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1

echo "check-periodic-via-scheduler: every timer is a periodic job run by internal/infra/jobs."
