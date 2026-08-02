#!/usr/bin/env bash
# check-periodic-via-scheduler.sh —— anything that runs on a timer runs through the one scheduler
# (backend/internal/infra/periodic).
#
# Three copies of the same loop used to exist, and each carried its own bookkeeping:
#
#   - the schedule shown on the Monitor panel was HAND-WRITTEN next to the interval, so it could
#     say "every 5m" while the ticker fired hourly and nothing would notice;
#   - the Register call was optional, so a loop could run forever and never appear on the panel at
#     all. corpus's Meili reconcile did exactly that, for its whole life.
#
# Rules:
#
#   1. `time.NewTicker` / `time.Tick` may only appear in internal/infra/periodic. Everything else
#      declares a periodic.Job and lets the scheduler own the loop.
#   2. Only the scheduler may Register a job on the board. Registering by hand means a name and a
#      schedule string that nothing checks against the interval that actually fires.
#
# No baseline: the last hand-written loop was deleted in the same change that added this gate.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^internal/infra/periodic/'

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
	echo "check-periodic-via-scheduler: $rel starts its own timer —— declare a periodic.Job instead; the loop, the interval and the Monitor bookkeeping belong to internal/infra/periodic."
	fail=1
done < <(goFiles | xargs grep -lE 'time\.NewTicker|time\.Tick\(' 2>/dev/null | sort)

while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-periodic-via-scheduler: $rel registers a job on the board by hand —— the schedule string must be derived from the interval that actually fires, which only the scheduler knows."
	fail=1
done < <(goFiles | xargs grep -lE 'jobRegistry\.Register\(|JobRegistry\)\.Register\(|board\.Register\(' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1

echo "check-periodic-via-scheduler: every timer runs through internal/infra/periodic; the panel's schedule is derived, not asserted."
