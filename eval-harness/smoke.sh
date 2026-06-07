#!/usr/bin/env bash
# smoke.sh —— eval-harness 独立调用 smoke。
#
# 证明 backend 的 agentic core (经 agentcore facade) 能被 backend 进程外的
# 独立 module 调起来，且完整 tool round-trip 通：对 dev/e2e llm-gateway 排队
# 确定性 tool_use + final reply，跑 harness 二进制，断言 transcript 里
# tool_started → tool_completed → 续转 assistant text → DONE end_turn 都在。
#
# gateway 由 `make eval-smoke` 的 gateway-up 依赖起好 (CLAUDE.md: docker 经
# Makefile)；本脚本只 curl + build + run + assert，不碰 docker。
set -euo pipefail

GATEWAY="${LLM_GATEWAY_URL:-http://localhost:9300}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)/eval-harness"

if ! curl -sf "$GATEWAY/__mock/inference/state" >/dev/null 2>&1; then
  echo "❌ llm-gateway 不在线 ($GATEWAY) —— 先 make gateway-up (或 make dev-up)" >&2
  exit 1
fi

echo "[smoke] building eval-harness…"
(cd "$HERE" && go build -o "$BIN" .)

echo "[smoke] queue scripted tool_use + final reply…"
curl -sf -X POST "$GATEWAY/__mock/inference/next_tool" \
  -H 'Content-Type: application/json' \
  -d '{"id":"t1","name":"corpus_search","args":{"query":"projects"}}' >/dev/null
curl -sf -X POST "$GATEWAY/__mock/inference/next_reply" \
  -H 'Content-Type: application/json' \
  -d '{"text":"I built Lucerna, a local-first thinking tool."}' >/dev/null

echo "[smoke] run harness…"
OUT="$("$BIN" --user 'tell me about your projects' 2>/dev/null)"
echo "─── transcript ───"
echo "$OUT"
echo "──────────────────"

fail=0
check() { grep -q "$1" <<<"$OUT" || { echo "❌ 缺: $2"; fail=1; }; }
check 'TOOL→.*corpus_search'           'tool_started (corpus_search)'
check 'TOOL←.*corpus_search.*Lucerna'  'tool_completed (canned result)'
check 'I built Lucerna'                'follow-up assistant text'
check 'DONE.*stop=end_turn'            'DONE end_turn'

if [ "$fail" -ne 0 ]; then
  echo "❌ eval-harness smoke FAILED"
  exit 1
fi
echo "✓ eval-harness smoke PASSED —— agentic core 独立可调用 + tool round-trip 通"
