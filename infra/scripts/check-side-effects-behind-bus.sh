#!/usr/bin/env bash
# check-side-effects-behind-bus.sh —— the request path holds no side-effect capability.
#
# Every port that affects the outside world (send mail, a supplier write, a webhook) lives under
# internal/infra/sideeffect/**. Only these may import it:
#
#   - internal/<domain>/subscriber  (a handler that reacts to a recorded event)
#   - internal/infra/**             (the ports themselves, and the job runtime)
#   - cmd/server/**                 (the composition root wires them)
#
# A use case, an op or a route that wants mail sent records an event; a subscriber sends it. So a
# crash between the write and the send loses nothing: the event is in the outbox.
# Design: docs/design/event-bus-outbox-webhooks.md, "Enforcement".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^(internal/[^/]+/subscriber/|internal/infra/|cmd/server/)'

goFiles() {
	find "$BK" -type f -name '*.go' -not -name '*_test.go' -not -path '*/node_modules/*' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-side-effects-behind-bus: scanned only $scanned Go files under $BK —— the scan is blind, not the tree clean."
	exit 2
fi

fail=0
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-side-effects-behind-bus: $rel imports a side-effect port —— record an event instead; a handler in internal/<domain>/subscriber performs the effect."
	fail=1
done < <(goFiles | xargs grep -lE '"github.com/atmaxmoj/standmeet/internal/infra/sideeffect(/|")' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1
echo "check-side-effects-behind-bus: only subscribers, infra and cmd/server hold a side-effect port."
