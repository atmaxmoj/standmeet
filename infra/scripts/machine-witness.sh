#!/usr/bin/env sh
# machine-witness —— 全量跑的时候，每分钟往 stdout 记一行「此刻这台机器上有谁」。
#
# **为什么需要它。** 全套要跑一个多小时，而一条红是不是证据，取决于**它出现的那一刻**机器
# 是什么样。我在 2026-08-19 连着栽了两次：
#   · 第 2 轮我自己在旁边跑 prod 驱动 + 真模型 eval，load 冲到 64，10 条红全部作废；
#   · 第 3 轮我声明「独占」，一小时后另一个项目的整套 e2e（lucerna-e2e）起来了，
#     常驻 1.5 核，后半程的 30s 超时红从此说不清是谁的问题。
# 两次都是**在启动那一刻断言了一次机器状态，然后当它一直成立**。它不会一直成立。
#
# 所以这里不做判断、不设阈值、不拦任何东西 —— 只留证据：跑完之后翻日志，
# 每条红都能对上它出生时的 load 和邻居。判据留给人，事实留给这行日志。
#
# 输出跟 playwright 的行混在同一份日志里，靠 `[machine]` 前缀挑出来：
#   grep '\[machine\]' full.log
#
# 别的项目的容器**不按名字白名单挑**：白名单会漏掉下一个新项目。凡是不属于本仓 compose
# 工程（standmeet-dev / standmeet-prod）的运行中容器，一律算邻居。

set -eu

INTERVAL="${WITNESS_INTERVAL:-60}"

# neighbours —— 不属于 standmeet 的运行中容器，按 compose 工程名归并计数。
neighbours() {
  docker ps --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null \
    | grep -v '^standmeet-' | grep -v '^$' | sort | uniq -c \
    | awk '{ printf "%s(%s) ", $2, $1 }'
}

while true; do
  load=$(uptime | awk -F'load average[s]*:' '{ gsub(/^[ \t]+/, "", $2); print $2 }')
  n=$(neighbours)
  printf '[machine %s] load=%s neighbours=%s\n' \
    "$(date -u +%H:%M:%SZ)" "$load" "${n:-none}"
  sleep "$INTERVAL"
done
