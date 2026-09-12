#!/usr/bin/env bash
# check-host-blind-to-blocks-test.sh —— the guard's own self-test.
#
# A guard that has never been seen red proves nothing: "it passes" and "it cannot see" look
# identical from outside. This plants each shape the guard exists to catch and asserts it
# goes red, then removes it and asserts green returns.
#
# Three probes, because the guard has three ways to go blind:
#   1. a shipped block id, quoted, in host code   → the defect itself
#   2. the same id on a comment line              → must stay GREEN (prose is documentation)
#   3. a block id nobody listed anywhere          → the subject is derived, so a NEW block
#                                                   directory must be covered with no edit
#                                                   to the guard. This is the one a
#                                                   hand-written token list always fails.

set -euo pipefail
cd "$(dirname "$0")/../.."

GUARD=infra/scripts/check-host-blind-to-blocks.sh
PROBE=backend/internal/probe_host_blind_selftest.go
NEWBLOCK=backend/blocks/selftest.probe

cleanup() { rm -f "$PROBE"; rm -rf "$NEWBLOCK"; }
trap cleanup EXIT

fail() { echo "check-host-blind-to-blocks-test: $1" >&2; exit 1; }

# Baseline: green before we touch anything. Otherwise a red below proves nothing.
"$GUARD" >/dev/null 2>&1 || fail "not green before the probes — fix the tree first"

# ── probe 1: a quoted shipped id in host code → red ────────────────────────────────
cat > "$PROBE" <<'GO'
package internal

var probeHostBlindSelftest = map[string]bool{"calendar.book": true}
GO
if "$GUARD" >/dev/null 2>&1; then
  fail "probe 1 did not go red: a quoted shipped block id in host code went unseen"
fi
rm -f "$PROBE"
"$GUARD" >/dev/null 2>&1 || fail "probe 1 left the tree red after removal"

# ── probe 2: the same id in a comment → still green ────────────────────────────────
cat > "$PROBE" <<'GO'
package internal

// probeHostBlindSelftest — prose may name "calendar.book"; that is documentation.
var probeHostBlindSelftest = true
GO
"$GUARD" >/dev/null 2>&1 || fail "probe 2 went red: a block id in a COMMENT is not a leak"
rm -f "$PROBE"

# ── probe 3: a block the guard was never told about → red ──────────────────────────
mkdir -p "$NEWBLOCK"
cat > "$NEWBLOCK/manifest.yaml" <<'YAML'
id: selftest.probe
title: Self-test probe
version: "1"
shape: visitor_only
acl: always
YAML
cat > "$PROBE" <<'GO'
package internal

var probeHostBlindSelftest = map[string]bool{"selftest.probe": true}
GO
if "$GUARD" >/dev/null 2>&1; then
  fail "probe 3 did not go red: the guard's subject is not derived from backend/blocks/"
fi
cleanup
"$GUARD" >/dev/null 2>&1 || fail "the tree is red after cleanup — a probe was left behind"

echo "check-host-blind-to-blocks-test: guard goes red on a named block, stays green on prose, and covers a block added without editing it."
