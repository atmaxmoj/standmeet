#!/usr/bin/env bash
# check-core-agnostic-test.sh —— self-test for check-core-agnostic (the ratchet must actually bite).
#
# Plants a NEW kernel file naming a concrete capability ("calendar") — a leak the ratchet has never
# seen (new filename → not in baseline). Asserts the guard goes RED, then GREEN once removed. This
# proves the "even if the AI forgets, the structure catches it" property is real, not aspirational.

set -uo pipefail
cd "$(dirname "$0")/../.."

CHECK=infra/scripts/check-core-agnostic.sh
PROBE=backend/internal/capabilities/zz_probe_agnostic.go
fail=0

cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT

# 1) baseline: the real tree is clean against its ratchet → checker passes.
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ baseline: check-core-agnostic should pass on the clean tree (ratchet holds)"
  fail=1
fi

# 2) plant a fresh kernel leak: a new file naming "calendar". New filename → the (file,token) pair
#    is not in the baseline → this is a NEW hit the ratchet must reject.
cat > "$PROBE" <<'EOF'
package capabilities

// a fresh leak the baseline has never seen — the ratchet must reject it.
func probeCalendarBook() string { return "calendar.book" }
EOF

if "$CHECK" >/dev/null 2>&1; then
  echo "❌ check-core-agnostic MISSED a new 'calendar' leak planted in internal/capabilities"
  fail=1
else
  echo "✓ caught the planted kernel-capability leak"
fi

# 3) remove the probe → clean again (back to matching the baseline exactly).
cleanup
trap - EXIT
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ tree not clean after the probe was removed"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "check-core-agnostic self-test FAILED"
  exit 1
fi
echo "✓ check-core-agnostic self-test passed"
