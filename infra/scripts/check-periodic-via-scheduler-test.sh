#!/usr/bin/env bash
# check-periodic-via-scheduler self-test: a gate that cannot go red is not a gate.
#
# Plants a hand-written ticker outside the job runtime and asserts it is caught.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT="$ROOT/cmd/server/zz_planted_periodic_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

# its own loop — the shape that ran on every replica and never showed on the panel.
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

cleanup
trap - EXIT

if ! bash "$HERE/check-periodic-via-scheduler.sh" >/dev/null 2>&1; then
  echo "check-periodic-via-scheduler: SELF-TEST FAILED — red after removing the planted file."
  exit 1
fi

echo "check-periodic-via-scheduler: self-test passed (a hand-written ticker goes red)."
