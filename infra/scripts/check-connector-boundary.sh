#!/usr/bin/env bash
# check-connector-boundary.sh —— Phase B 结构门：凭据永不出 vault（go-arch 级）。
#
# 出站连接器客户端（internal/gcal · internal/mailer，持 owner token/密码代调）
# **只能**被 connector 层（internal/connector）+ composition root（cmd/server）
# 依赖。capability / usecases 层**不得直接 import** —— 必须经 connector proxy 拿
# 句柄代调。违规 = capability 代码手里就有明文 token，破坏「凭据永不出 vault」。
#
# 配合 connector-secret-no-leak.spec.ts 从两侧夹：结构上碰不到 + 行为上不泄漏。
# Phase B 落地（把 gcal/mailer 调用搬进 internal/connector）后本检查转绿。
set -euo pipefail
cd "${1:-.}"   # → 目标 Go 源根（backend/）

# 允许直连出站客户端的目录：connector 层 + 接线（composition root）。
ALLOWED='internal/connector|cmd/server'

# find + grep（不靠 grep -r/--include 的 GNU 行为：Alpine 的 BusyBox grep 对
# -r 的输出会带 ./ 前缀、--include 也不同，导致 ^ALLOWED 排除失配）。sed 去 ./
# 前缀让锚点在 GNU/BusyBox 两边一致命中。
violations=$(find internal cmd -name '*.go' ! -name '*_test.go' \
  -exec grep -lE '"github\.com/atmaxmoj/standmeet/internal/(gcal|mailer)"' {} + 2>/dev/null \
  | sed 's|^\./||' \
  | { grep -vE "^($ALLOWED)/" || true; })

if [ -n "$violations" ]; then
  echo "check-connector-boundary: 出站连接器客户端 (gcal/mailer) 只能经 connector 层。" >&2
  echo "下列文件越界直连（凭据应走 connector proxy，capability 不得碰 token）：" >&2
  echo "$violations" | sed 's/^/  /' >&2
  exit 1
fi
echo "check-connector-boundary: gcal/mailer reached only through the connector layer."
