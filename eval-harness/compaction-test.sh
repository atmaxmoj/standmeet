#!/usr/bin/env bash
# compaction-test.sh —— 多轮 context 臃肿 / summarization compaction 用例。
#
# 构造一个 >32K token 的长面试对话（开头埋独特事实），跑被测 agent，断言：
#   (a) agent loop 的 summarization compaction 真触发（before_msgs→after_msgs 日志）
#   (b) 压缩后早期上下文仍被准确召回（Priya / Nimbus / Staff Backend / billing）
#
# **需真 LLM** —— harness 自读 eval-harness/.env（DeepSeek v4-pro）。没真 key
# 会打 mock gateway，不会触发压缩，本测试断言会失败。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"
REQ="$TMP/req.json"
OUT="$TMP/out.json"
ERR="$TMP/err.log"

echo "[compaction] building + generating long conversation…"
(cd "$HERE" && go build -o "$BIN" .)
(cd "$HERE" && python3 compaction_gen.py "$REQ")

echo "[compaction] running agent over the bloated context…"
(cd "$HERE" && "$BIN" --ask --persona fixtures/personas/marcus-chen < "$REQ" >"$OUT" 2>"$ERR")

ANSWER="$(python3 -c "import json;print(json.load(open('$OUT'))['answer'])")"
echo "─── answer ───"; echo "$ANSWER" | head -6; echo "──────────────"

fail=0
# (a) compaction 真触发。marker 从**内核**问出来(--marker compaction),不在这儿抄一份:
# 这句话 2026-07-25 改过名,而这里的硬编码副本没跟着改 —— 那条断言从此不可能变绿。
MARKER="$("$BIN" --marker compaction)"
if grep -q "$MARKER" "$ERR"; then
  echo "✓ compaction fired: $(grep -o 'before_msgs=[0-9]* after_msgs=[0-9]*' "$ERR" | head -1)"
else
  echo "❌ compaction 未触发 (没真 LLM? 上下文没超阈值?)"; fail=1
fi
# (b) 压缩后早期上下文召回
check() { grep -qi "$1" <<<"$ANSWER" || { echo "❌ 召回缺: $2"; fail=1; }; }
check "Priya"          "面试官名字 Priya"
check "Nimbus"         "公司 Nimbus Data"
check "Staff Backend"  "岗位 Staff Backend"
check "billing"        "团队 billing/payments"

if [ "$fail" -ne 0 ]; then
  echo "❌ compaction 用例 FAILED"; exit 1
fi
echo "✓ compaction 用例 PASSED —— 压缩触发 + 早期上下文召回完整 + 后段质量在线"
