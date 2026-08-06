#!/usr/bin/env bash
# check-core-agnostic-test.sh —— self-test for check-core-agnostic (the ratchet must actually bite).
#
# Plants a NEW kernel file naming a concrete capability ("calendar") — a leak the ratchet has never
# seen (new filename → not in baseline). Asserts the guard goes RED, then GREEN once removed. This
# proves the "even if the AI forgets, the structure catches it" property is real, not aspirational.

set -uo pipefail
cd "$(dirname "$0")/../.."

CHECK=infra/scripts/check-core-agnostic.sh
# Derive the probe location from the checker's own CORE_DIRS rather than hardcoding one: a
# hardcoded path silently rots when the package moves (this probe pointed at the dissolved
# internal/usecases). Planting into the FIRST kernel dir the checker actually scans also means the
# probe can never drift out of the scanned set.
PROBE_DIR="$(grep -m1 '^CORE_DIRS=' "$CHECK" | sed 's/^CORE_DIRS="//; s/".*//' | tr ' ' '\n' | head -1)"
PROBE="$PROBE_DIR/zz_probe_agnostic.go"
PROBE_PKG="$(sed -n 's/^package \([a-z0-9_]*\).*/\1/p' "$(find "$PROBE_DIR" -maxdepth 1 -name '*.go' ! -name '*_test.go' | head -1)" | head -1)"
fail=0

cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT

# 1) baseline: the real tree is clean against its ratchet → checker passes.
if ! "$CHECK" >/dev/null 2>&1; then
  echo "❌ baseline: check-core-agnostic should pass on the clean tree (ratchet holds)"
  fail=1
fi

# 2) plant one fresh kernel leak per leaf capability. A guard only sees the tokens it lists, so
#    "it caught calendar" says nothing about the rest —— every capability that ships gets its own
#    probe here, and adding a capability without adding its word to TOKENS shows up as a MISS.
probe_leak() { # <name> <expression the plant returns>
  cat > "$PROBE" <<EOF
package $PROBE_PKG

// a fresh leak the baseline has never seen — the ratchet must reject it.
func probeLeak() string { return "$2" }
EOF
  if "$CHECK" >/dev/null 2>&1; then
    echo "❌ check-core-agnostic MISSED a planted '$1' leak in $PROBE_DIR"
    fail=1
  else
    echo "✓ caught the planted $1 leak"
  fi
  rm -f "$PROBE"
}

probe_leak calendar.book         "calendar.book"
probe_leak corpus.retrieval      "corpus.retrieval"
probe_leak summarize_conversation "summarize_conversation"
probe_leak ask_visitor           "ask_visitor"
probe_leak askVisitor            "askVisitorTool" # camelCase form of the same id
probe_leak mail.send             "MailSender"

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
