#!/usr/bin/env bash
# compaction-test.sh —— 多轮 context 臃肿 / summarization compaction 用例。**两条腿。**
#
# 腿一（对话腿）：>32K token 的长面试对话（开头埋独特事实），断言
#   (a) agent loop 的 summarization compaction 真触发（before_msgs→after_msgs 日志）
#   (b) 压缩后早期上下文仍被准确召回（Priya / Nimbus / Staff Backend / billing）
#   —— 考的是压缩任务书第 1–5 条：**对话事实**。
#
# 腿二（工具腿，F-D-10）：历史故意留在阈值以下，让**工具先跑**，再由一份 44K 字符的
# 外部报告把上下文顶过线 —— 于是压缩发生在工具结果已经进窗口之后。断言
#   (c) 工具真被调了，且压缩排在工具之后（不是在工具之前就压完了 —— 那样这条腿测的
#       是另一条路，而它会看起来一样绿）
#   (d) 那一轮**答得出**报告里的两个数字（语料里没有，只有工具返回过，而且报告是一次性的
#       —— 重读补不回来，只能从摘要里来）
#   —— 考的是「压缩必须把工具返回的实质带走」。这条只有真模型判得了：替身不做摘要，
#      回声里什么都在，在那一侧断言无条件为真（e2e 那条只守到「问对了」）。
#
# 红是**看着它红过**的，不是推的：把任务书削成「只留身份、去掉所有数字和引文」再跑一遍，
# 答案两个数字全掉了，还改口说「thousands of events per day / a few hours」—— 正是 prod
# 那次的样子。同时也量清了一件事：**第 6 条不是那个分水岭** —— 单删它，DeepSeek 照样把
# 数字带过来（第 2、4 条已经在拉这个活）。所以这条腿守的是那个**性质**，不是那句话。
#
# **需真 LLM** —— harness 自读 eval-harness/.env（DeepSeek v4-pro）。没真 key
# 会打 mock gateway，不会触发压缩，本测试断言会失败。
set -euo pipefail

# 循环里的 Info 行要落进 stderr —— 工具腿判的「工具 vs 压缩谁先谁后」全靠它们。
export EVAL_LOG_LEVEL=info

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"

echo "[compaction] building…"
(cd "$HERE" && go build -o "$BIN" .)

# MARKER —— 压缩那行日志。从**内核**问出来(--marker compaction),不在这儿抄一份:
# 这句话 2026-07-25 改过名,而这里的硬编码副本没跟着改 —— 那条断言从此不可能变绿。
MARKER="$("$BIN" --marker compaction)"
fail=0

# run_leg <leg> —— 生成 → 跑一轮 → 回显答案。产物落在 $TMP/<leg>.{json,out,err}。
run_leg() {
  local leg="$1"
  REQ="$TMP/$leg.json"; OUT="$TMP/$leg.out"; ERR="$TMP/$leg.err"
  (cd "$HERE" && python3 compaction_gen.py "$REQ" "$leg")
  echo "[compaction/$leg] running agent…"
  (cd "$HERE" && "$BIN" --ask --persona fixtures/personas/marcus-chen < "$REQ" >"$OUT" 2>"$ERR")
  ANSWER="$(python3 -c "import json;print(json.load(open('$OUT'))['answer'])")"
  echo "─── answer ($leg) ───"; echo "$ANSWER" | head -6; echo "──────────────"
  # **先把换行压平再比**：答案是散文，模型在哪儿断行不由我们定。这条判据曾经因为
  # `Staff\nBackend Engineer` 正好在两个词之间换行而报「岗位没召回」—— 而那句话就在
  # 屏幕上。判的是「这个事实还在不在」，不是「它有没有被排在同一行」。
  FLAT="$(tr '\n' ' ' <<<"$ANSWER")"
}

check() { grep -qi -- "$1" <<<"$FLAT" || { echo "❌ 召回缺: $2"; fail=1; }; }

fired() {  # 压缩到底有没有发生 —— 下面每一条都建在它上面
  if grep -q "$MARKER" "$ERR"; then
    echo "✓ compaction fired: $(grep -o 'before_msgs=[0-9]* after_msgs=[0-9]*' "$ERR" | head -1)"
  else
    echo "❌ compaction 未触发 (没真 LLM? 上下文没超阈值?)"; fail=1
  fi
}

# ── 腿一：对话事实（任务书 1–5） ─────────────────────────────────────────
run_leg conv
fired
check "Priya"          "面试官名字 Priya"
check "Nimbus"         "公司 Nimbus Data"
check "Staff Backend"  "岗位 Staff Backend"
check "billing"        "团队 billing/payments"

# ── 腿二：工具返回的实质（任务书第 6 条，F-D-10） ───────────────────────
run_leg tools
fired
# (c) 顺序：工具必须排在压缩**之前**。
#
# 这一条不是形式主义 —— 少了它，「压缩之前工具就跑完、结果还新鲜」和「压缩把结果吃掉
# 之后仍答得出」在屏幕上一模一样，而只有后者是这条 eval 要判的东西。
# **第一条**工具完成行，不是最后一条：模型在压缩之后往往还会再伸手够一次那份报告
# （够到的是"已经取过了"）。要判的是"工具结果进过被压缩的那个窗口"，那是**最早**那次；
# 拿最后一次去比，判的成了那次徒劳的重试，于是本该绿的跑被报成"压缩排在工具之前"。
TOOL_LINE="$(grep -n 'agent tool done' "$ERR" | head -1 | cut -d: -f1 || true)"
COMPACT_LINE="$(grep -n "$MARKER" "$ERR" | tail -1 | cut -d: -f1 || true)"
if [ -z "$TOOL_LINE" ]; then
  echo "❌ 工具腿没调工具 —— 那这一轮根本没有工具结果可丢"; fail=1
elif [ -z "$COMPACT_LINE" ] || [ "$COMPACT_LINE" -lt "$TOOL_LINE" ]; then
  echo "❌ 压缩排在工具之前 (tool@$TOOL_LINE compact@${COMPACT_LINE:-none})"
  echo "   → 历史长度该调：工具结果还没进窗口，压缩就已经发生了"; fail=1
else
  echo "✓ 顺序对: 工具 @$TOOL_LINE → 压缩 @$COMPACT_LINE"
fi
# (d) 压缩之后，那一轮仍然答得出**只有工具返回过**的两个数字。
check "4.7 million"  "报告里的峰值吞吐 4.7 million transactions per day"
check "41 minute"    "报告里的中断时长 41 minutes"
#
# 那份报告为什么是**一次性**的：
#
# 第一版不是，于是判据挡不住"重读一遍补回来"—— 模型发现证据没了就把工具重跑一遍（日志里
# 压缩那行之后又冒出两次 tool start），然后照样答对。那样这条断言分不出"摘要带走了实质"和
# "重读补回来"，它单独立着不可能变红（[[assertion-that-cannot-fail]]）。我一度想改用"压缩
# 后零工具调用"当判据，多跑几次才看清那是闪的：装着第 6 条也会重读
# （[[two-samples-of-a-flake-look-like-a-rule]]）。
#
# 一次性把这条路堵死：第二次调用回一句"已经取过了"，那两个数字**只能**从摘要里来。prod
# 那次也正是这个处境：374KB 的结果重读一遍会再次撑爆窗口，于是那一轮变成一句
# "what would you like to dig into next?"（F-D-10）。

if [ "$fail" -ne 0 ]; then
  echo "❌ compaction 用例 FAILED"; exit 1
fi
echo "✓ compaction 用例 PASSED —— 两条腿都在：对话事实召回 + 工具实质活过压缩"
