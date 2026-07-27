#!/usr/bin/env bash
# check-routes-not-imported.sh —— internal/routes/** 是**最顶层**(controller/reach-out),
# 不该被任何别的包 import。只有组装入口能挂它:cmd/server(composition root)、agentcore
# (eval driver 入口)。
#
# 别的包(域 / infra / capabilities / usecases)import routes = 层次倒置(下层依赖上层)。
# 已知存量违规放 backend/.routes-import-baseline(每行一个 importer 目录,相对 backend/;
# 只能缩)。允许的入口不进 baseline、也不算违规。
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
BASELINE="$BK/.routes-import-baseline"
# 组装入口:允许 import routes
ALLOWED_ENTRY='^cmd/|^agentcore(/|$)|^internal/routes/'

violations=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	dir="$(dirname "${f#"$BK"/}")"
	echo "$dir" | grep -qE "$ALLOWED_ENTRY" && continue
	case " $violations " in *" $dir "*) ;; *) violations="$violations $dir" ;; esac
done < <(grep -rlE 'atmaxmoj/standmeet/internal/routes/' "$BK/internal" "$BK/cmd" "$BK/agentcore" --include='*.go' 2>/dev/null | grep -v '_test.go' | sort)

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
		echo "check-routes-not-imported: $v import 了 internal/routes/** —— routes 是顶层,只有 cmd/agentcore 能挂它。"
		fail=1
	fi
done
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-routes-not-imported: baseline 里的 $b 已不再 import routes,请从 .routes-import-baseline 删这行(只能缩)。"
		fail=1
	fi
done
[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-routes-not-imported: routes 只被入口(cmd/agentcore)挂 (${n} 个待清存量在 baseline,棘轮成立)。"
