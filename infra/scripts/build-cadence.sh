#!/usr/bin/env sh
# build-cadence —— 每次 prod 构建前，把**最近的构建节奏**摆到眼前。
#
# 为什么这个机制存在（2026-08-18 的效率复盘）：今晚 11 小时里 `make prod-app` 跑了 8 次，
# 每次 2–3 分钟；20 段十分钟以上的空档累计约 6 小时，大头就是构建 + lint。
# 而账本上真正的病因不是「构建慢」，是**一个一个修**：每条缺陷各自走一遍
# 「改 → 建 → 眼验 → lint → 提交」。
#
# **为什么不是写规矩**：昨晚已经把「收红不中途修」写进 CLAUDE.md 了，今晚照样回潮。
# 原因是每条红在**当下**都有正当理由立刻闭环 —— 而攒批的收益要到几次之后才显现。
# 决策的那一刻，成本是不可见的（[[structure-means-no-responsibility-class]]）。
#
# 所以这里不拦、不判、不要求记住任何事，只做一件事：**把不可见的成本变成可见的**。
# 决策仍然是人的，但至少是在知情下做的。
#
# 判据（为什么是 3 次/小时）：一次 prod 构建 ~2.5 分钟。3 次即 ~8 分钟纯等待，
# 已经够攒一批了。这不是阈值告警，是一句提醒。

set -eu

LOG="${TMPDIR:-/tmp}/standmeet-build-log"
NOW=$(date +%s)
KIND="${1:-build}"

# 只留最近一小时的记录。
if [ -f "$LOG" ]; then
  awk -v cutoff="$((NOW - 3600))" '$1 >= cutoff' "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
else
  : > "$LOG"
fi

n=$(grep -c . "$LOG" || true)
if [ "$n" -ge 3 ]; then
  first=$(head -1 "$LOG" | cut -d' ' -f1)
  mins=$(( (NOW - first) / 60 ))
  echo ""
  echo "  ┌─ build cadence ─────────────────────────────────────────"
  echo "  │  这是最近 ${mins} 分钟里第 $((n + 1)) 次构建。"
  echo "  │  一次 prod 构建约 2.5 分钟 —— 已经花掉约 $(( (n + 1) * 5 / 2 )) 分钟在等。"
  echo "  │"
  echo "  │  如果手上还有别的改动待做，先攒到一批再建："
  echo "  │  一次构建 + 一趟眼验 + 一次 lint + 一个提交。"
  echo "  └─────────────────────────────────────────────────────────"
  echo ""
fi

echo "$NOW $KIND" >> "$LOG"
