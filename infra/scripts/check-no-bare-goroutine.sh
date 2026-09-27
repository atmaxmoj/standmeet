#!/usr/bin/env bash
# check-no-bare-goroutine.sh —— application code starts no goroutine.
#
# A bare `go f()` is unbounded, has no timeout, cannot be stopped at shutdown, and is lost on a
# restart. Background work is a job (internal/infra/jobs: Enqueue, or a jobs.Periodic). Process
# plumbing that must own a goroutine (a socket accept loop, a LISTEN connection, an in-process
# cache warm) lives in internal/infra/**, or in the composition root (cmd/server/**).
#
# A `go` statement anywhere else in backend/ (non-test) is red.
# Design: docs/design/event-bus-outbox-webhooks.md, "Concurrency and goroutines".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^(internal/infra/|cmd/server/)'

goFiles() {
	find "$BK" -type f -name '*.go' -not -name '*_test.go' -not -path '*/node_modules/*' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-no-bare-goroutine: scanned only $scanned Go files under $BK —— the scan is blind, not the tree clean."
	exit 2
fi

fail=0
while IFS= read -r hit; do
	[ -n "$hit" ] || continue
	rel="${hit#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-no-bare-goroutine: $rel —— a bare goroutine; Enqueue a job (internal/infra/jobs), or move the plumbing into internal/infra."
	fail=1
done < <(goFiles | xargs grep -nE '^[[:space:]]*go[[:space:]]+[A-Za-z_(]' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1
echo "check-no-bare-goroutine: goroutines start only in internal/infra and cmd/server."
