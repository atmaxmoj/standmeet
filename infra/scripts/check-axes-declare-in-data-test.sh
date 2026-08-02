#!/usr/bin/env bash
# check-axes-declare-in-data self-test: a gate that cannot go red is not a gate.
#
# Plants both escapes — a capability manifest written as a Go literal in the assembly root, and a
# socket path back inside a declaration — and asserts each one is caught.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT_GO="$ROOT/cmd/server/zz_planted_axes_selftest.go"
PLANT_DIR="$ROOT/capabilities/zz_planted_selftest"

cleanup() { rm -f "$PLANT_GO"; rm -rf "$PLANT_DIR"; }
trap cleanup EXIT

# escape 1: the root describing a capability instead of assembling one.
cat > "$PLANT_GO" <<'GO'
package main

import "github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"

// plantedSelfTestManifest —— planted by check-axes-declare-in-data-test.sh; removed again.
func plantedSelfTestManifest() mcpplugin.Manifest {
	return mcpplugin.Manifest{ID: "planted.selftest"}
}
GO

if bash "$HERE/check-axes-declare-in-data.sh" >/dev/null 2>&1; then
  echo "check-axes-declare-in-data: SELF-TEST FAILED — a Manifest literal in the assembly root passed."
  exit 1
fi
rm -f "$PLANT_GO"

# escape 2: a declaration naming the file it wants mounted — the shape this whole change removed.
mkdir -p "$PLANT_DIR"
cat > "$PLANT_DIR/manifest.yaml" <<'YAML'
id: zz.planted.selftest
transport:
  kind: sandbox_stdio
  env:
    PLANTED_SOCKET: /run/standmeet/zz.planted.selftest.sock
YAML

if bash "$HERE/check-axes-declare-in-data.sh" >/dev/null 2>&1; then
  echo "check-axes-declare-in-data: SELF-TEST FAILED — a socket path inside a declaration passed."
  exit 1
fi

cleanup
trap - EXIT

if ! bash "$HERE/check-axes-declare-in-data.sh" >/dev/null 2>&1; then
  echo "check-axes-declare-in-data: SELF-TEST FAILED — red after removing the planted files."
  exit 1
fi

echo "check-axes-declare-in-data: self-test passed (both escapes go red)."
