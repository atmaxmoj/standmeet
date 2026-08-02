#!/usr/bin/env bash
# check-hostops-via-desk self-test: a gate that cannot go red is not a gate.
#
# Plants BOTH escapes the gate exists to stop — the composition root opening its own capability
# socket, and the composition root minting its own host op — and asserts each one is caught.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT="$ROOT/cmd/server/zz_planted_hostops_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

# escape 1: a hand-written gateway in the composition root — exactly what the desk replaced.
cat > "$PLANT" <<'GO'
package main

// plantedSelfTestSocket —— planted by check-hostops-via-desk-test.sh; removed again.
func plantedSelfTestSocket() string {
	return "capsocket.ListenWith"
}
GO

if bash "$HERE/check-hostops-via-desk.sh" >/dev/null 2>&1; then
  echo "check-hostops-via-desk: SELF-TEST FAILED — the root opening its own capability socket passed."
  exit 1
fi

# escape 2: the root declaring a verb of its own instead of a domain declaring it.
cat > "$PLANT" <<'GO'
package main

import "github.com/atmaxmoj/standmeet/internal/infra/hostop"

// plantedSelfTestOp —— planted by check-hostops-via-desk-test.sh; removed again.
func plantedSelfTestOp() hostop.Op {
	return hostop.Op{Name: "planted.selftest"}
}
GO

if bash "$HERE/check-hostops-via-desk.sh" >/dev/null 2>&1; then
  echo "check-hostops-via-desk: SELF-TEST FAILED — the root minting its own host op passed."
  exit 1
fi

cleanup
trap - EXIT

if ! bash "$HERE/check-hostops-via-desk.sh" >/dev/null 2>&1; then
  echo "check-hostops-via-desk: SELF-TEST FAILED — red after removing the planted files."
  exit 1
fi

echo "check-hostops-via-desk: self-test passed (both escapes go red)."
