#!/usr/bin/env bash
# check-knobs-reachable-test.sh —— the gate must go red on the defect it exists for.
#
# Plants an owner-facing knob that nothing on the prod stack can set (exactly F-G-2's shape) and
# expects a non-zero exit. A gate nobody has watched fail is a gate that might be scanning nothing
# (gate-can-go-blind).
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/backend/cmd/server/config/config.go"
BACKUP="$(mktemp)"
cp "$CONFIG" "$BACKUP"
restore() { cp "$BACKUP" "$CONFIG"; rm -f "$BACKUP"; }
trap restore EXIT

# A knob no compose file passes and .env.example never names. Not a *_BASE_URL, so not exempt.
printf '\n// planted by check-knobs-reachable-test.sh\nvar _ = os.Getenv("PLANTED_OWNER_KNOB")\n' >> "$CONFIG"

if "$ROOT/infra/scripts/check-knobs-reachable.sh" >/dev/null 2>&1; then
	echo "check-knobs-reachable self-test FAILED: an unreachable owner knob passed the gate"
	exit 1
fi
echo "✓ check-knobs-reachable self-test passed (a planted unreachable knob goes red)"
