#!/usr/bin/env bash
# check-internal-dirs.sh —— backend/internal/ 下只允许三类目录:
#   1) 类图的 8 个 core 领域模块 (backend-domain-modules.md 类图)
#   2) 通用 app 层 usecases + 真正的入站 controller routes
#   3) domain-less 的公共 DDD 基础设施 (pgstore/cryptobox/httpx/... — 见白名单)
# 类图里没有、又不属于上述任何一类的目录 = "多出来的东西",必须拆掉归位
# (功能移进某个 core 模块 / usecases / 或外置出 internal/,如 plugins→mcp-servers/)。
#
# 白名单外的目录命中即红。已知待拆的存量违规放在 .internal-dirs-baseline(只能缩:
# 拆掉一个就从 baseline 删一行;baseline 里已不存在的目录也要删)。新增白名单外目录 = 红。
#
# 用法: check-internal-dirs.sh [seed]   seed 重新播种 baseline
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"
BASELINE="$ROOT/backend/.internal-dirs-baseline"

# ── 白名单:类图 core 模块 + routes + usecases + domain-less infra ──
ALLOWED="
access conversation connector corpus owner security marketplace stats
capreg
routes usecases
apierr capsocket cryptobox gotenberg httpx pgstore postgres retry sandbox sandboxws search storage middleware session
"

is_allowed() {
	for a in $ALLOWED; do [ "$1" = "$a" ] && return 0; done
	return 1
}

# 当前 internal/ 下所有目录
dirs=""
for d in "$INTERNAL"/*/; do
	[ -d "$d" ] || continue
	dirs="$dirs $(basename "$d")"
done

# violations = 白名单外的目录
violations=""
for d in $dirs; do
	is_allowed "$d" || violations="$violations $d"
done

if [ "${1:-}" = "seed" ]; then
	for v in $violations; do echo "$v"; done | sort
	exit 0
fi

# baseline 里的已知违规
baseline=""
[ -f "$BASELINE" ] && baseline="$(grep -vE '^\s*(#|$)' "$BASELINE" || true)"

fail=0

# 1) 违规但不在 baseline → 新增的多余目录,红
for v in $violations; do
	found=0
	for b in $baseline; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-internal-dirs: internal/$v 不在白名单(类图/usecases/infra)也不在 baseline —— 类图里没有的目录不许新增,请拆掉归位。"
		fail=1
	fi
done

# 2) baseline 里的目录已不存在(拆掉了)→ 必须从 baseline 删(只能缩)
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-internal-dirs: baseline 里的 internal/$b 已拆掉,请从 backend/.internal-dirs-baseline 删这一行(baseline 只能缩)。"
		fail=1
	fi
done

[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-internal-dirs: internal/ 只含白名单目录 (${n} 个待拆存量在 baseline,棘轮成立)。"
