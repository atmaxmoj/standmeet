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

# bare_tsx —— TSX 里的裸 z-<n> 工具类。只认 class 串里的,避免误伤变量名。
bare_tsx=$(find app/src -name '*.tsx' -print0 2>/dev/null | xargs -0 -r grep -nE '(class|className)="[^"]*[[:space:]"]z-[0-9]+' || true)
if [ -n "$bare_tsx" ]; then
  echo "check-one-layer-scale: a bare z-<n> utility instead of z-[var(--z-*)]:"
  echo "$bare_tsx"
  fail=1
fi

# 自证:两条判定各喂一段种进去的坏写法,都必须判红。
planted_css=$(mktemp -t layercss.XXXXXX); planted_tsx=$(mktemp -t layertsx.XXXXXX)
printf '.sm-planted { z-index: 42; }\n' > "$planted_css"
printf '<div className="fixed inset-0 z-40" />\n' > "$planted_tsx"
seen_css=$(grep -n 'z-index:' "$planted_css" | grep -v -- '--z-' || true)
seen_tsx=$(grep -nE '(class|className)="[^"]*[[:space:]"]z-[0-9]+' "$planted_tsx" || true)
rm -f "$planted_css" "$planted_tsx"
if [ -z "$seen_css" ] || [ -z "$seen_tsx" ]; then
  echo "check-one-layer-scale: SELF-TEST FAILED — the scan misses a planted bare layer value"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-layer-scale: one layer scale (self-test passed: planted bare css + tsx both go red)."
