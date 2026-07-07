#!/usr/bin/env bash
# ghost-test.sh —— Ghost steering eval: drive the ghost scenarios through the SAME
# prod loop (agentcore facade), inject each scenario's waypoints into the frozen
# RoleSnapshot, and assert the emitted ghost matches the gold expect_ghost.
#
# The steering JUDGMENT (which waypoint, silence-or-not, momentum) is what this
# checks — the deterministic `assert` half of the design's eval seam. Voice /
# coherence are the `human` half (read the transcript, not asserted here).
#
# Gateway comes up via `make eval-ghost`'s gateway-up dep (CLAUDE.md: docker via
# Makefile). The runner scripts the mock ghost per scenario and captures the
# `ghost` frame the loop emits after `done`.
set -euo pipefail

GATEWAY="${LLM_GATEWAY_URL:-http://localhost:9300}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)/eval-harness"

if ! curl -sf "$GATEWAY/__mock/inference/state" >/dev/null 2>&1; then
  echo "❌ llm-gateway offline ($GATEWAY) —— run make gateway-up (or make dev-up)" >&2
  exit 1
fi

echo "[ghost] building eval-harness…"
(cd "$HERE" && go build -o "$BIN" .)

echo "[ghost] run ghost scenarios (waypoint gold)…"
set +e
OUT="$("$BIN" --scenarios "$HERE/scenarios" --grep ghost --endpoint "$GATEWAY" 2>/dev/null)"
set -e
echo "─── transcript ───"
echo "$OUT"
echo "──────────────────"

fail=0
check() { grep -q "$1" <<<"$OUT" || { echo "❌ missing: $2"; fail=1; }; }
# The runner does the typed gold-check (checkGhostGold) + prints a GOLD line per scenario.
# momentum: visitor points at alpha → ghost targets grasp-alpha (not higher-weight pricing)
check 'GOLD ghost.*ghost-momentum.*grasp-alpha ✓'   'momentum → target grasp-alpha'
# one-or-none: all waypoints visited → silence (no ghost)
check 'GOLD ghost.*ghost-silence.*silence ✓'         'silence when all visited'

if [ "$fail" -ne 0 ]; then
  echo "❌ ghost eval: gold mismatch"; exit 1
fi
echo "✅ ghost eval: waypoint gold matched"
