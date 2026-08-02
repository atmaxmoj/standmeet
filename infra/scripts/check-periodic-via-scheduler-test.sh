#!/usr/bin/env bash
# check-periodic-via-scheduler self-test: a gate that cannot go red is not a gate.
#
# Plants both escapes — a hand-written ticker outside the scheduler, and a hand-written job
# registration — and asserts each one is caught.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT="$ROOT/cmd/server/zz_planted_periodic_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

# escape 1: its own loop — the shape that grew three copies with three sets of bookkeeping.
cat > "$PLANT" <<'GO'
package main

import "time"

// plantedSelfTestTicker —— planted by check-periodic-via-scheduler-test.sh; removed again.
func plantedSelfTestTicker() *time.Ticker {
	return time.NewTicker(time.Minute)
}
GO

if bash "$HERE/check-periodic-via-scheduler.sh" >/dev/null 2>&1; then
  echo "check-periodic-via-scheduler: SELF-TEST FAILED — a hand-written ticker passed."
  exit 1
fi

# escape 2: a hand-written schedule string on the panel, free to drift from the real interval.
cat > "$PLANT" <<'GO'
package main

// plantedSelfTestRegister —— planted by check-periodic-via-scheduler-test.sh; removed again.
func plantedSelfTestRegister(d *runtimeDeps) {
	d.jobRegistry.Register("planted selftest", "every 5m")
}
GO

if bash "$HERE/check-periodic-via-scheduler.sh" >/dev/null 2>&1; then
  echo "check-periodic-via-scheduler: SELF-TEST FAILED — a hand-written job registration passed."
  exit 1
fi

cleanup
trap - EXIT

if ! bash "$HERE/check-periodic-via-scheduler.sh" >/dev/null 2>&1; then
  echo "check-periodic-via-scheduler: SELF-TEST FAILED — red after removing the planted file."
  exit 1
fi

echo "check-periodic-via-scheduler: self-test passed (both escapes go red)."
