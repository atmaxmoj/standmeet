#!/usr/bin/env sh
# check-one-scrim —— 模态遮罩只能有**一个来源**。
#
# 为什么这条闸门存在(UX-48):四个 `*-overlay` 规则原本各写一条
# `color-mix(in oklab, var(--color-ink) 40%, transparent)`。四条字面量谁也不知道彼此存在 ——
# 调其中一处,另外三处悄悄分叉,而分叉在界面上不会报错,只会让某些模态压得住底层、某些压不住。
#
# 锁的是**结构**不是数值:数值(66%)是审美判断,写个断言核对它等于它自己是恒真的空话;
# 会真正腐烂的是「四处各写各的」。
#
# **范围刻意收窄到 `-overlay` 规则块里的 background** —— `color-mix(ink, N%)` 本身是这套
# 视觉语言到处在用的正当手法(纸面纹理、代码块底、引用左边线)。第一版没收窄,把它们全判红了:
# 闸门管太宽会逼着合法代码绕路(见 [[gate-scope-forces-architecture]])。
#
# 自证:把一段种进去的坏写法喂给同一个判定,必须判红;判不红说明扫描器瞎了
# (见 [[gate-can-go-blind]])。

set -eu

CSS_DIR="app/src"
TOKEN_FILE="app/src/app/globals.css"

fail=0

# 1) token 必须存在 —— 否则下面所有 var(--sm-scrim) 都是空引用,而空引用在 CSS 里是静默的。
if ! grep -q -- '--sm-scrim:' "$TOKEN_FILE"; then
  echo "check-one-scrim: --sm-scrim is not defined in $TOKEN_FILE"
  fail=1
fi

# scan_overlays —— 在 `*-overlay {` 块内找自己拼的 background。stdin 收 CSS,命中即打印。
scan_overlays() {
  awk '
    /-overlay[^{]*\{/ { inblock = 1 }
    inblock && /background[^;]*color-mix/ { print FILENAME ":" FNR ": " $0 }
    inblock && /\}/ { inblock = 0 }
  ' "$@"
}

offenders=$(find "$CSS_DIR" -name '*.css' -print0 2>/dev/null | xargs -0 -r awk '
  /-overlay[^{]*\{/ { inblock = 1 }
  inblock && /background[^;]*color-mix/ { print FILENAME ":" FNR ":" $0 }
  inblock && /\}/ { inblock = 0 }
' || true)

if [ -n "$offenders" ]; then
  echo "check-one-scrim: an *-overlay rule hand-rolls its scrim instead of using var(--sm-scrim):"
  echo "$offenders"
  fail=1
fi

# 2) TSX 里的内联遮罩 —— **第一版闸门完全看不见这一类**,而遮罩真正的多数派在这儿:
#    6 处 `className="fixed inset-0 ... bg-(--color-ink)/40"`,一处都没被扫到。
#    第一版还带着"自证",但那个自证只证明了「在我选择扫描的文件类型里种一个坏例子能被看见」,
#    **没有证明扫描范围覆盖了遮罩实际存在的地方** —— 自证证错了东西(见 [[gate-can-go-blind]])。
inline=$(grep -rn -- 'fixed inset-0' app/src 2>/dev/null \
  | grep -- 'bg-(--color-ink)/' || true)
if [ -n "$inline" ]; then
  echo "check-one-scrim: an inline overlay hand-rolls its scrim instead of bg-(--sm-scrim):"
  echo "$inline"
  fail=1
fi

# 3) `bg-(--x)` 这个简写**只对注册在 `@theme` 里的 token 有效**。`--sm-scrim` 在普通 `:root`,
#    于是 Tailwind 不认识它,**一条 CSS 都不生成** —— 类名进了 HTML,规则不存在,遮罩从 40% 变成 0。
#    我真这么干过一次,而且 typecheck / eslint / 这条闸门当时**全绿**:没有任何工具会说
#    "这个 class 没有对应规则"。只有回真实环境看一眼才发现底层文字反而更清楚了。
#    所以这里显式禁掉简写形式,只准 `bg-[var(--sm-scrim)]`。
shorthand=$(grep -rn -- 'bg-(--sm-scrim)' app/src 2>/dev/null || true)
if [ -n "$shorthand" ]; then
  echo "check-one-scrim: bg-(--sm-scrim) generates NO css (--sm-scrim is not a @theme token)."
  echo "                 use bg-[var(--sm-scrim)] instead:"
  echo "$shorthand"
  fail=1
fi

# 4) 自证:种一个坏 overlay 规则,同一个判定必须看得见它。
planted_file=$(mktemp -t scrimcheck.XXXXXX)
cat > "$planted_file" <<'PLANTED'
.sm-planted-modal-overlay {
  position: fixed;
  background: color-mix(in oklab, var(--color-ink) 40%, transparent);
}
PLANTED
if [ -z "$(scan_overlays "$planted_file")" ]; then
  rm -f "$planted_file"
  echo "check-one-scrim: SELF-TEST FAILED — the scan cannot see a planted hand-rolled scrim"
  exit 2
fi
rm -f "$planted_file"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-scrim: one scrim source (self-test passed: a planted hand-rolled overlay goes red)."
