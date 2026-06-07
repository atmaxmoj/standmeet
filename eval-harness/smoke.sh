#!/usr/bin/env bash
# smoke.sh —— eval-harness 独立调用 smoke (批量)。
#
# 证明 backend 的 agentic core (经 agentcore facade) 能被 backend 进程外的
# 独立 module 调起来：跑批量 runner 过 scenarios/ (每个自己 script 确定性
# llm-gateway)，断言 transcript 里 tool round-trip (tool_started →
# tool_completed → 续转 text → DONE) + 纯文本 turn + 末尾 summary 全绿。
#
# gateway 由 `make eval-smoke` 的 gateway-up 依赖起好 (CLAUDE.md: docker 经
# Makefile)；本脚本只 build + run + assert，scenario 的 gateway scripting 在
# runner 里 (runner.go scriptGateway)。
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

echo "[smoke] run batch over scenarios/…"
set +e
OUT="$("$BIN" --scenarios "$HERE/scenarios" --endpoint "$GATEWAY" 2>/dev/null)"
code=$?
set -e
echo "─── transcript ───"
echo "$OUT"
echo "──────────────────"

fail=0
check() { grep -q "$1" <<<"$OUT" || { echo "❌ 缺: $2"; fail=1; }; }
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
  echo "❌ batch exit $code (某 scenario error/fatal)"; fail=1
fi
if [ "$fail" -ne 0 ]; then
  echo "❌ eval-harness smoke FAILED"
  exit 1
fi
echo "✓ eval-harness smoke PASSED —— agentic core 独立可调用 + 批量 scenario + tool round-trip 通"
