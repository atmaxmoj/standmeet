#!/usr/bin/env bash
# check-boundary-thin self-test: plant each of the three violations and assert
# the gate rejects them, then assert it is green again once removed.
#
#   1. a facade that declares a function instead of re-exporting one
#   2. the dispatcher declaring a payload shape of its own
#   3. the dispatcher importing a domain's guts instead of its facade

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
TOOL="$(mktemp)"
FACADE_PLANT="$ROOT/internal/stats/facade/zz_boundary_selftest.go"
SHAPE_PLANT="$ROOT/internal/routes/dispatcher/zz_boundary_selftest.go"

cleanup() { rm -f "$FACADE_PLANT" "$SHAPE_PLANT" "$TOOL"; }
trap cleanup EXIT

( cd "$HERE/check-boundary-thin" && go build -o "$TOOL" . )

run_gate() { ( cd "$ROOT" && "$TOOL" >/dev/null 2>&1 ) }

if ! run_gate; then
  echo "check-boundary-thin: SELF-TEST FAILED — red before planting anything."
  exit 1
fi

cat > "$FACADE_PLANT" <<'GO'
package stats

// plantedSelfTestFn —— planted by check-boundary-thin-test.sh; removed again.
func plantedSelfTestFn() string { return "a facade should not compute anything" }
GO
if run_gate; then
  echo "check-boundary-thin: SELF-TEST FAILED — a facade with a function passed."
  exit 1
fi
rm -f "$FACADE_PLANT"

cat > "$SHAPE_PLANT" <<'GO'
package dispatcher

// plantedSelfTestShape —— planted by check-boundary-thin-test.sh; removed again.
type plantedSelfTestShape struct {
	Field string `json:"field"`
}
GO
if run_gate; then
  echo "check-boundary-thin: SELF-TEST FAILED — a payload shape in the dispatcher passed."
  exit 1
fi

cat > "$SHAPE_PLANT" <<'GO'
package dispatcher

import _ "github.com/atmaxmoj/standmeet/internal/corpus/repo"
GO
if run_gate; then
  echo "check-boundary-thin: SELF-TEST FAILED — the dispatcher reached past a facade."
  exit 1
fi
rm -f "$SHAPE_PLANT"

if ! run_gate; then
  echo "check-boundary-thin: SELF-TEST FAILED — still red after removing the plants."
  exit 1
fi

echo "check-boundary-thin: self-test passed (facade function, dispatcher shape, and"
echo "  a reach past a facade each go red)."
