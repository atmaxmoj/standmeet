#!/usr/bin/env bash
# check-no-core-capability-fibers self-test: plants each shape the gate exists to stop — a
# feature fiber registered at the door, and a module handing fibers up — and requires red; then
# requires the clean tree to pass again.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DOOR="$HERE/../../backend/internal/routes/blockload/zz_planted_capability_selftest.go"
MOD="$HERE/../../backend/internal/owner/zz_planted_capability_selftest.go"

cleanup() { rm -f "$DOOR" "$MOD"; }
trap cleanup EXIT

cat > "$DOOR" <<'GO'
package blockload

// planted by check-no-core-capability-fibers-test.sh; removed again.
func plantedCapabilitySelfTest(reg interface{ MustRegister(any) }) { reg.MustRegister(newJobsFiber()) }
GO
if bash "$HERE/check-no-core-capability-fibers.sh" >/dev/null 2>&1; then
  echo "check-no-core-capability-fibers: SELF-TEST FAILED — a feature fiber at the door passed."
  exit 1
fi
rm -f "$DOOR"

cat > "$MOD" <<'GO'
package owner

// planted by check-no-core-capability-fibers-test.sh; removed again.
var plantedFibers = []registry.Fiber{}
GO
if bash "$HERE/check-no-core-capability-fibers.sh" >/dev/null 2>&1; then
  echo "check-no-core-capability-fibers: SELF-TEST FAILED — a module handing fibers up passed."
  exit 1
fi

cleanup
trap - EXIT
echo "check-no-core-capability-fibers: self-test passed (a door fiber and a fiber slice both go red)."
