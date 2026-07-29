#!/usr/bin/env bash
# check-no-mock-test.sh —— self-test for check-no-mock (the checker had no test of its own).
#
# The name-blacklist misses a **name-neutral** test-double. The robust, name-independent signal is
# an IMPORT of a test-only package (testing / testify / httptest) in a non-test backend file — prod
# code has no business importing those. This test plants exactly that and asserts the checker catches
# it. RED before the import-based check is added (the blacklist lets a neutrally-named importer pass).

set -uo pipefail
cd "$(dirname "$0")/../.."

CHECK=infra/scripts/check-no-mock
# Derive the probe location instead of hardcoding one: a hardcoded path silently rots the moment
# the package moves (this self-test, and two others, broke that way when internal/usecases was
# dissolved). Any real non-test Go package under backend/internal serves as the host.
PROBE_DIR="$(dirname "$(find backend/internal -name '*.go' ! -name '*_test.go' | head -1)")"
PROBE="$PROBE_DIR/zz_probe_double.go"
PROBE_PKG="$(sed -n 's/^package \([a-z0-9_]*\).*/\1/p' "$(find "$PROBE_DIR" -maxdepth 1 -name '*.go' ! -name '*_test.go' | head -1)" | head -1)"
fail=0

cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT

# 1) baseline: the real tree is clean → checker passes.
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ baseline: check-no-mock should pass on the clean tree"
  fail=1
fi

# 2) plant a name-neutral test-double: a non-test prod file importing testify. No blacklisted name,
#    so only an import-based check catches it.
cat > "$PROBE" <<EOF
package $PROBE_PKG

import "github.com/stretchr/testify/require"

// neutrally-named — the name-blacklist can't see this; only the import gives it away.
var probeAssert = require.New
EOF

if "$CHECK" >/dev/null 2>&1; then
  echo "❌ check-no-mock MISSED a testify import in a non-test prod file (name-blacklist gap)"
  fail=1
else
  echo "✓ caught the planted test-only import"
fi

# 3) remove the probe → clean again.
cleanup
trap - EXIT
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ tree not clean after the probe was removed"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "check-no-mock self-test FAILED"
  exit 1
fi
echo "✓ check-no-mock self-test passed"
