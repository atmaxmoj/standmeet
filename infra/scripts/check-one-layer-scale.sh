#!/usr/bin/env sh
# check-one-layer-scale —— 层级只能有**一处声明**。
#
# 为什么这条闸门存在:「谁在谁上面」这件事,在这个 app 里**读不出来**。19 处层级散在两种语言里 ——
# CSS 九处魔数(30/35/40/41/50/60/60/60/80)、TSX 十处工具类(z-10/20/30/40×5/50×2),
# 没有任何一处声明这些数字的顺序含义。而「模态遮罩」这一件事本身就有**三个不同的 z**
# (ModalShell 的 z-50、5 处内联 overlay 的 z-40、CSS overlay 的 60)—— 模态根本不是同一层。
#
# 后果不是难看:一个遮罩到底盖没盖住底层,**只能靠试**。owner 定的判据是
# 「不可以通过实验判别,要么看日志,要么架构清晰到一眼看出来」——
# 这条闸门就是把「一眼看出来」变成强制的(见 [[no-diagnosis-by-experiment]])。
#
# 允许的唯一写法:CSS 用 `var(--z-*)`,TSX 用 `z-[var(--z-*)]`。量表本身在 globals.css 的 :root。
#
# 自证:种一段裸 z-index 和一个裸 z-40,两个判定都必须看得见 —— 扫描器要能自证看得见
# (见 [[gate-can-go-blind]];前一条闸门的自证只覆盖了它选中的文件类型,漏了另一半)。

set -eu

TOKEN_FILE="app/src/app/globals.css"
fail=0

if ! grep -q -- '--z-modal:' "$TOKEN_FILE"; then
  echo "check-one-layer-scale: the layer scale (--z-*) is not defined in $TOKEN_FILE"
  fail=1
fi

# bare_css —— CSS 里任何**不走量表**的 z-index。**没有例外。**
#
# 我一度给 `z-index: 0 / auto` 开了豁免（理由是它们不声称"我在全局第几层",而是就地造一个
# 层叠上下文）。owner 否掉了:「你要是全用了 css 定义的 z,那你就把裸露的 z-index 用 lint 给 ban 了」。
# 他是对的 —— **带例外的规则会被侵蚀**:那个豁免是我的一次判断,下一个人得重新判一遍,
# 而"这算不算层级声明"恰恰是最容易说服自己的地方。
# 正当的用法照样表达得出来,只是也走量表:`z-index: var(--z-local)`（=0）。
bare_css=$(find app/src -name '*.css' -print0 2>/dev/null | xargs -0 -r grep -n 'z-index:' \
  | grep -v -- 'var(--z-' | grep -v -- '--z-' || true)
if [ -n "$bare_css" ]; then
  echo "check-one-layer-scale: a bare z-index instead of var(--z-*):"
  echo "$bare_css"
  fail=1
fi

# 带内偏移只能是 +1..+9。层与层之间隔 10,所以 `calc(var(--z-modal) + 1)` 是"同一带里排先后",
# 而 `+ 10` 就撞上下一层了 —— 那不是排序,那是**偷偷换层**,而且看起来跟合法写法一模一样。
# 允许相对偏移是为了让「谁压谁」写在它该在的尺度上:跨层的事改这张表,带内的事在用它的地方写。
big_offset=$(find app/src -name '*.css' -o -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE 'var\(--z-[a-z-]+\)[[:space:]]*\+[[:space:]]*[0-9]{2,}' || true)
if [ -n "$big_offset" ]; then
  echo "check-one-layer-scale: a layer offset of 10+ escapes its band — use +1..+9:"
  echo "$big_offset"
  fail=1
fi

# bare_tsx —— TSX 里的裸 z-<n> 工具类。只认 class 串里的,避免误伤变量名。
#
# **TSX 只准写类名**：`sm-z-modal` / `sm-z-modal-3`。裸 `z-40` 和任意值 `z-[...]` 都禁 ——
# 后者虽然指向量表，但它让"层级"这件事在用的地方以两种写法出现，而**一个概念两种写法**
# 正是词汇分叉的起点（见 [[vocabulary-must-not-diverge]]）。收成一个封闭集合之后，
# 「这个东西在第几层」永远只有一种读法。
#
# **引号种类要全收**：第一版只认 `className="…"`,于是 `className={`…`}`(模板字面量)整类
# 看不见 —— BubbleToolbar 里的 `z-50` 就是这么活下来的,而闸门当时报绿。
# 更糟的是那版**自证**种的也是双引号那一种:它只证明了扫描器认得它已经认得的写法,
# **没有证明扫描范围覆盖了逃逸真正发生的地方**(见 [[gate-can-go-blind]] / [[verifier-can-lie-about-its-own-coverage]])。
# 现在两种引号都收,自证也两种都种。
bare_tsx=$(find app/src -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE '(class|className)=[{]?["`][^"`]*[[:space:]"`](z-[0-9]+|z-\[)' || true)
if [ -n "$bare_tsx" ]; then
  echo "check-one-layer-scale: use a layer class (sm-z-<band>[-1..9]), not z-<n> or z-[...]:"
  echo "$bare_tsx"
  fail=1
fi

# 自证:两条判定各喂一段种进去的坏写法,都必须判红。
planted_css=$(mktemp -t layercss.XXXXXX); planted_tsx=$(mktemp -t layertsx.XXXXXX)
printf '.sm-planted { z-index: 42; }\n' > "$planted_css"
{
  printf '<div className="fixed inset-0 z-40" />\n'
  printf '<div className={`fixed inset-0 z-50 ${x}`} />\n'
} > "$planted_tsx"
seen_css=$(grep -n 'z-index:' "$planted_css" | grep -v -- '--z-' || true)
# 两种引号各种一行,所以这里要求**两条**都被看见 —— 只中一条说明还有一整类是盲区。
tsx_hits=$(grep -cE '(class|className)=[{]?["`][^"`]*[[:space:]"`]z-[0-9]+' "$planted_tsx" || true)
seen_tsx=''
[ "$tsx_hits" = "2" ] && seen_tsx='both'
rm -f "$planted_css" "$planted_tsx"
if [ -z "$seen_css" ] || [ -z "$seen_tsx" ]; then
  echo "check-one-layer-scale: SELF-TEST FAILED — the scan misses a planted bare layer value"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-layer-scale: one layer scale (self-test passed: planted bare css + tsx both go red)."
