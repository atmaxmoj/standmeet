#!/usr/bin/env bash
# check-infra-not-domain.sh —— internal/infra/** 禁止反向 import 任何**域**(core module)。
#
# infra 是 domain-less 基建(pgxpool / crypto / http / storage / …),是**叶子**。它反手
# import 域(corpus/access/owner/…) = 层次倒置。基建服务域,不认识域。
#
# 已知存量违规放 backend/.infra-domain-baseline(每行一个文件,只能缩:修一个删一行,
# baseline 里已不存在的也要删)。baseline 外的 infra→域 import = 红。
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INFRA="$ROOT/backend/internal/infra"
BASELINE="$ROOT/backend/.infra-domain-baseline"
DOMAINS='corpus|conversation|connector|access|owner|security|marketplace|stats'

# 当前 infra 里 import 域的文件(相对 backend/)
violations=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	violations="$violations ${f#"$ROOT"/backend/}"
done < <(grep -rlE "atmaxmoj/standmeet/internal/($DOMAINS)\"" "$INFRA" --include='*.go' 2>/dev/null | grep -v '_test.go' | sort)

if [ "${1:-}" = "seed" ]; then
	for v in $violations; do echo "$v"; done
	exit 0
fi

baseline=""
[ -f "$BASELINE" ] && baseline="$(grep -vE '^\s*(#|$)' "$BASELINE" || true)"

fail=0
for v in $violations; do
	found=0
	for b in $baseline; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-infra-not-domain: $v import 了域(core module) —— infra 是叶子,不许反向依赖域。"
		fail=1
	fi
done
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-infra-not-domain: baseline 里的 $b 已不再 import 域,请从 .infra-domain-baseline 删这行(只能缩)。"
		fail=1
	fi
done
[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-infra-not-domain: infra 不反向依赖域 (${n} 个待清存量在 baseline,棘轮成立)。"
