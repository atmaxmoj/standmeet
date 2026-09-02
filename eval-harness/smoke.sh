#!/usr/bin/env bash
# smoke.sh —— standalone smoke call for eval-harness (batch).
#
# Proves backend's agentic core (via the agentcore facade) can be invoked
# from a module outside the backend process: runs the batch runner over
# scenarios/ (each with its own deterministic llm-gateway script), asserts
# the transcript's tool round-trip (tool_started → tool_completed →
# continued text → DONE) + a pure-text turn + the final summary all pass.
#
# The gateway is brought up by `make eval-smoke`'s gateway-up dependency
# (CLAUDE.md: docker via Makefile); this script only builds + runs + asserts,
# the scenario's gateway scripting lives in runner.go (scriptGateway).
set -euo pipefail

GATEWAY="${LLM_GATEWAY_URL:-http://localhost:9300}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)/eval-harness"

if ! curl -sf "$GATEWAY/__mock/inference/state" >/dev/null 2>&1; then
  echo "❌ llm-gateway is not up ($GATEWAY) — run make gateway-up (or make dev-up) first" >&2
  exit 1
fi

echo "[smoke] building eval-harness…"
(cd "$HERE" && go build -o "$BIN" .)

echo "[smoke] run batch over scenarios/…"
set +e
OUT="$("$BIN" --scenarios "$HERE/scenarios" --endpoint "$GATEWAY" 2>/dev/null)"
code=$?
set -e
echo "─── transcript ───"
echo "$OUT"
echo "──────────────────"

fail=0
check() { grep -q "$1" <<<"$OUT" || { echo "❌ missing: $2"; fail=1; }; }
# tool round-trip (visitor-asks-projects)
check 'TOOL→.*corpus_search'           'tool_started (corpus_search)'
check 'TOOL←.*corpus_search.*Lucerna'  'tool_completed (canned result)'
check 'I built Lucerna'                'follow-up assistant text'
# pure-text turn (visitor-plain-greeting)
check "I'm the owner's AI"             'plain-greeting assistant text'
# summary tally
check 'visitor-asks-projects.*tools=1 stop=end_turn'   'summary: projects'
check 'visitor-plain-greeting.*tools=0 stop=end_turn'  'summary: greeting'

if [ "$code" -ne 0 ]; then
  echo "❌ batch exit $code (some scenario error/fatal)"; fail=1
fi
if [ "$fail" -ne 0 ]; then
  echo "❌ eval-harness smoke FAILED"
  exit 1
fi
echo "✓ eval-harness smoke PASSED —— agentic core is standalone-callable + batch scenarios + tool round-trip all pass"
