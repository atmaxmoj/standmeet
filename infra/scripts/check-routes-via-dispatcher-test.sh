#!/usr/bin/env bash
# check-routes-via-dispatcher-test —— self-test: plant a new violating file,
# the gate must turn red.
#
# A gate that has never gone red is not a gate. What's planted here is
# exactly what it's meant to catch: a **new** file under internal/routes
# (not in the baseline) that directly imports a domain facade — i.e.
# bypasses the outbound convergence point and reaches the domain itself.
#
# Plant → expect red → delete. The planted file never participates in a
# build (it's deleted right after planting) and never stays in the tree.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../backend" && pwd)"
PLANT="$ROOT/internal/routes/admin/zz_dispatcher_gate_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

cat > "$PLANT" <<'EOF'
// Planted file for the self-test, generated and immediately deleted by check-routes-via-dispatcher-test.sh.
package admin

import security "github.com/atmaxmoj/standmeet/internal/security/facade"

var _ *security.BannedIPRepo
EOF

tool="$(mktemp)"
( cd "$(dirname "$0")/check-routes-via-dispatcher" && go build -o "$tool" . )

set +e
out="$( cd "$ROOT" && "$tool" 2>&1 )"
rc=$?
set -e
rm -f "$tool"

if [ "$rc" -eq 0 ]; then
  echo "check-routes-via-dispatcher: SELF-TEST FAILED — planted a new file that bypasses the convergence point, but the gate is green."
  echo "$out"
  exit 1
fi

if ! grep -q "zz_dispatcher_gate_selftest.go" <<<"$out"; then
  echo "check-routes-via-dispatcher: SELF-TEST FAILED — the gate went red, but not for the planted file."
  echo "$out"
  exit 1
fi

echo "check-routes-via-dispatcher: self-test passed (a planted domain-facade import goes red)."
