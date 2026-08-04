#!/usr/bin/env bash
# check-core-seals-only-test.sh —— self-test for check-core-seals-only (the ratchet must bite).
#
# Plants two probes, because the invariant has two escapes and only one of them is obvious:
#   1. the direct one —— a kernel file calling cryptobox.Decrypt;
#   2. the indirect one —— a kernel file taking a decrypter **from outside** and invoking it.
# (2) is the one that got past every import-arrow check for real: a `func([]byte) ([]byte, error)`
# field imports nothing illegal. A guard that only catches (1) would have missed the actual leak.
#
# Also asserts the scanner is not blind: it must report having read kernel files.

set -uo pipefail
cd "$(dirname "$0")/../.."

CHECK=infra/scripts/check-core-seals-only.sh
# Derive the probe location from the checker's own CORE_DIRS —— a hardcoded path silently rots
# when a package moves, and the probe would then sit outside the scanned set forever (green,
# proving nothing).
PROBE_DIR="$(grep -m1 '^CORE_DIRS=' "$CHECK" | sed 's/^CORE_DIRS="//; s/".*//' | tr ' ' '\n' | head -1)"
PROBE="$PROBE_DIR/zz_probe_seals.go"
PROBE_PKG="$(sed -n 's/^package \([a-z0-9_]*\).*/\1/p' "$(find "$PROBE_DIR" -maxdepth 1 -name '*.go' ! -name '*_test.go' | head -1)" | head -1)"
fail=0

cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT

# 0) the scanner must say how many kernel files it read —— a green from a blind scan is worthless.
if ! "$CHECK" 2>/dev/null | grep -qE '[1-9][0-9]* kernel files scanned'; then
  echo "❌ check-core-seals-only reported no scanned kernel files (blind scanner)"
  fail=1
fi

# 1) baseline: the real tree matches its declared exceptions → green.
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ baseline: check-core-seals-only should pass on the clean tree (ratchet holds)"
  fail=1
fi

# 2) escape A —— the kernel calls the crypto box directly.
cat > "$PROBE" <<EOF
package $PROBE_PKG

func probeDirectUnseal(b []byte) []byte {
	out, _ := cryptobox.Decrypt(b, nil)
	return out
}
EOF
if "$CHECK" >/dev/null 2>&1; then
  echo "❌ MISSED a direct cryptobox.Decrypt planted in $PROBE_DIR"
  fail=1
else
  echo "✓ caught the planted direct unseal"
fi

# 3) escape B —— the kernel takes a decrypter from outside and invokes it. Every import legal.
cat > "$PROBE" <<EOF
package $PROBE_PKG

type probeOpener struct {
	Unsealer func([]byte) ([]byte, error)
}

func (p *probeOpener) open(b []byte) []byte {
	out, _ := p.Unsealer(b)
	return out
}
EOF
if "$CHECK" >/dev/null 2>&1; then
  echo "❌ MISSED an injected unsealer invoked inside $PROBE_DIR (the escape with all-green imports)"
  fail=1
else
  echo "✓ caught the planted injected unsealer"
fi

# 4) remove the probe → back to exactly the declared exceptions.
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
