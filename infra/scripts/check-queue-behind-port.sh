#!/usr/bin/env bash
# check-queue-behind-port.sh —— the queue library stays behind our own jobs port.
#
# Upper layers see internal/infra/jobs only: strings and JSON. The River implementation lives in
# internal/infra/jobs/river, the only package that imports riverqueue. Replacing River must change
# no code outside that directory.
#
# An import of github.com/riverqueue/** anywhere else in backend/ (tests included) is red.
# Design: docs/design/event-bus-outbox-webhooks.md, "Interfaces: the implementation is swappable".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^internal/infra/jobs/river/'

goFiles() {
	find "$BK" -type f -name '*.go' -not -path '*/node_modules/*' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-queue-behind-port: scanned only $scanned Go files under $BK —— the scan is blind, not the tree clean."
	exit 2
fi

fail=0
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-queue-behind-port: $rel imports riverqueue —— use the jobs port (internal/infra/jobs); only internal/infra/jobs/river knows River."
	fail=1
done < <(goFiles | xargs grep -lE '"github.com/riverqueue/' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1
echo "check-queue-behind-port: riverqueue is imported only in internal/infra/jobs/river."
