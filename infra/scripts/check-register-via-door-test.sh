#!/usr/bin/env bash
# check-register-via-door self-test: a gate that cannot go red is not a gate.
#
# Plants the escapes the gate exists to stop — the composition root registering a block itself,
# and the composition root wiring a seam provider into the core registry — and asserts each one
# is caught; then asserts the clean tree is green again (docs/design/plugin/everything-is-a-block.md,
# "Its self-test plants a Register call outside the door and requires red").

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLANT="$HERE/../../backend/cmd/server/zz_planted_register_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

plant() {
  cat > "$PLANT" <<GO
package main

// plantedRegisterSelfTest —— planted by check-register-via-door-test.sh; removed again.
func plantedRegisterSelfTest(reg interface{ $1(any) }) { reg.$1(nil) }
GO
}

for verb in MustRegister RegisterOrigin; do
  plant "$verb"
  if bash "$HERE/check-register-via-door.sh" >/dev/null 2>&1; then
    echo "check-register-via-door: SELF-TEST FAILED — .$verb( in the composition root passed."
    exit 1
  fi
done

cat > "$PLANT" <<'GO'
package main

// plantedSeamSelfTest —— planted by check-register-via-door-test.sh; removed again.
func plantedSeamSelfTest(depReg interface{ Register(any) }) { depReg.Register(nil) }
GO
if bash "$HERE/check-register-via-door.sh" >/dev/null 2>&1; then
  echo "check-register-via-door: SELF-TEST FAILED — depReg.Register( in the composition root passed."
  exit 1
fi

cleanup
trap - EXIT

if ! bash "$HERE/check-register-via-door.sh" >/dev/null 2>&1; then
  echo "check-register-via-door: SELF-TEST FAILED — red after removing the planted file."
  exit 1
fi

echo "check-register-via-door: self-test passed (block, origin and seam registration outside the door go red)."
