#!/usr/bin/env bash
# check-retry-only-in-jobs.sh —— retry has one owner: the job layer (internal/infra/jobs).
#
# Nested retry layers multiply: 3 layers × 3 attempts turned one failure into up to 27 requests.
# A job handler only classifies its failure (nil / Snooze / Discard / retryable error); the kind's
# declared policy decides when to try again. A synchronous call someone waits on gets at most the
# httpx transport's retry, never a second loop around it.
#
# `retry.Do` anywhere in backend/ (non-test) outside internal/infra/jobs is red.
# Design: docs/design/event-bus-outbox-webhooks.md, "Retry".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^internal/infra/jobs/'

goFiles() {
	find "$BK" -type f -name '*.go' -not -name '*_test.go' -not -path '*/node_modules/*' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-retry-only-in-jobs: scanned only $scanned Go files under $BK —— the scan is blind, not the tree clean."
	exit 2
fi

fail=0
while IFS= read -r hit; do
	[ -n "$hit" ] || continue
	rel="${hit#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-retry-only-in-jobs: $rel —— a retry loop outside the job layer; run the work as a job and classify its failure instead."
	fail=1
done < <(goFiles | xargs grep -nE 'retry\.Do\(' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1
echo "check-retry-only-in-jobs: retry.Do appears only in internal/infra/jobs."
