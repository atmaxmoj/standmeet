#!/usr/bin/env bash
# check-core-seals-only-test.sh —— self-test for check-core-seals-only (the ratchet must bite).
#
# Plants three probes, one per escape the guard has to cover:
#   1. the kernel calls the crypto box directly;
#   2. the kernel takes an unsealer **from outside** and invokes it —— this one imports nothing
#      illegal, so every import-arrow check stays green while the kernel opens what it is given.
#      It is the escape that was actually in the tree, and a guard looking only for the crypto
#      package would have missed it;
#   3. an inward-but-not-kernel package (an owner-side repo, say) opens the at-rest vault.
#
# Also asserts the scanner is not blind: a green from a scan that read nothing proves nothing.

set -uo pipefail
cd "$(dirname "$0")/../.."

CHECK=infra/scripts/check-core-seals-only.sh

# Derive both probe locations from the checker's own variables —— a hardcoded path silently rots
# when a package moves, and the probe would then sit outside the scanned set forever (green,
# proving nothing). This self-test caught exactly that when KERNEL_DIRS was renamed.
KERNEL_DIR="$(grep -m1 '^KERNEL_DIRS=' "$CHECK" | sed 's/^KERNEL_DIRS="//; s/".*//' | tr ' ' '\n' | head -1)"
INWARD_ROOT="$(grep -m1 '^INWARD_ROOT=' "$CHECK" | sed 's/^INWARD_ROOT="//; s/".*//')"

pkg_of() {
  sed -n 's/^package \([a-z0-9_]*\).*/\1/p' \
    "$(find "$1" -maxdepth 1 -name '*.go' ! -name '*_test.go' | head -1)" | head -1
}

KERNEL_PROBE="$KERNEL_DIR/zz_probe_seals.go"
KERNEL_PKG="$(pkg_of "$KERNEL_DIR")"

# An inward dir that is NOT the kernel and NOT skipped by the checker —— pick the owner repo the
# real tree seals through, so probe 3 lands where sealing is legal but opening is not.
INWARD_DIR="$INWARD_ROOT/owner/repo"
INWARD_PROBE="$INWARD_DIR/zz_probe_seals.go"
INWARD_PKG="$(pkg_of "$INWARD_DIR")"

fail=0
cleanup() { rm -f "$KERNEL_PROBE" "$INWARD_PROBE"; }
trap cleanup EXIT

# 0) the scanner must say how many files it read, in BOTH scopes.
if ! "$CHECK" 2>/dev/null | grep -qE '[1-9][0-9]* kernel \+ [1-9][0-9]* inward files scanned'; then
  echo "❌ check-core-seals-only reported an empty scan in one of its scopes (blind scanner)"
  fail=1
fi

# 1) baseline: the real tree matches its declared exceptions → green.
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ baseline: check-core-seals-only should pass on the clean tree (ratchet holds)"
  fail=1
fi

# 2) escape A —— the kernel calls the crypto box directly.
cat > "$KERNEL_PROBE" <<EOF
package $KERNEL_PKG

func probeDirectUnseal(b []byte) []byte {
	out, _ := cryptobox.Decrypt(b, nil)
	return out
}
EOF
if "$CHECK" >/dev/null 2>&1; then
  echo "❌ MISSED a direct cryptobox.Decrypt planted in $KERNEL_DIR"
  fail=1
else
  echo "✓ caught the planted direct unseal"
fi
rm -f "$KERNEL_PROBE"

# 3) escape B —— the kernel takes an unsealer from outside and invokes it. Every import legal.
cat > "$KERNEL_PROBE" <<EOF
package $KERNEL_PKG

type probeOpener struct {
	Unsealer func([]byte) ([]byte, error)
}

func (p *probeOpener) open(b []byte) []byte {
	out, _ := p.Unsealer(b)
	return out
}
EOF
if "$CHECK" >/dev/null 2>&1; then
  echo "❌ MISSED an injected unsealer invoked inside $KERNEL_DIR (the escape with all-green imports)"
  fail=1
else
  echo "✓ caught the planted injected unsealer"
fi
rm -f "$KERNEL_PROBE"

# 4) escape C —— an inward package outside the kernel opens the at-rest vault.
cat > "$INWARD_PROBE" <<EOF
package $INWARD_PKG

func probeInwardUnseal(b, aad []byte) []byte {
	out, _ := cryptobox.Decrypt(b, aad)
	return out
}
EOF
if "$CHECK" >/dev/null 2>&1; then
  echo "❌ MISSED an at-rest unseal planted in $INWARD_DIR (inward side, outside the kernel)"
  fail=1
else
  echo "✓ caught the planted inward-side unseal"
fi

# 5) remove the probes → back to exactly the declared exceptions.
cleanup
trap - EXIT
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ tree not clean after the probes were removed"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "check-core-seals-only self-test FAILED"
  exit 1
fi
echo "✓ check-core-seals-only self-test passed"
