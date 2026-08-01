#!/usr/bin/env bash
# check-routes-cyclo self-test: a gate that cannot go red is not a gate.
#
# Plants a branchy function inside the dispatcher, asserts the check rejects it,
# removes it, and asserts the check is green again.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT="$ROOT/internal/routes/dispatcher/zz_planted_cyclo_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

cat > "$PLANT" <<'GO'
package dispatcher

// plantedSelfTestRule —— planted by check-routes-cyclo-test.sh; removed again.
func plantedSelfTestRule(a, b, c, d int) int {
	if a > 0 {
		return 1
	}
	if b > 0 {
		return 2
	}
	if c > 0 {
		return 3
	}
	if d > 0 {
		return 4
	}
	return 0
}
GO

if bash "$HERE/check-routes-cyclo.sh" "$ROOT" >/dev/null 2>&1; then
  echo "check-routes-cyclo: SELF-TEST FAILED — a planted cyclo-5 function passed."
  exit 1
fi

cleanup
trap - EXIT

if ! bash "$HERE/check-routes-cyclo.sh" "$ROOT" >/dev/null 2>&1; then
  echo "check-routes-cyclo: SELF-TEST FAILED — red after removing the planted function."
  exit 1
fi

echo "check-routes-cyclo: self-test passed (a planted branchy function goes red)."
