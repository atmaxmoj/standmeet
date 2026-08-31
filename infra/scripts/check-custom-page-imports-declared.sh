#!/usr/bin/env sh
# check-custom-page-imports-declared —— 面板上写着能 import 什么，就得真能 import。
#
# **为什么这条闸门存在**：owner 在面板上写页面时，能用哪些包**只有读 `builder/vendor/`
# 才知道** —— 屏幕上一个字都没说（2026-08-30 owner 自己撞上：「我想引用我们的 chat
# 功能，我完全不知道写什么」）。修法是在面板上列出来。
#
# 而"列出来"立刻造出第二份事实：面板上那份清单，和 builder 真正 vendor 的那份。
# 两份会漂移，而漂移的方向恰好最坏 —— 面板说能用，构建时报 module not found，
# owner 以为是自己写错了。这正是 [[one-source-per-ui-primitive]] 那条账。
#
# 所以闸门守一个方向：**面板提到的每一个 @standmeet/* 包，builder 必须 vendor 了它。**
# 反方向不管 —— vendor 了但没在面板上宣传，是取舍不是缺陷。

set -eu

PANEL="app/src/lib/admin/custom-page-imports.ts"
VENDOR="builder/vendor/@standmeet"

[ -f "$PANEL" ] || { echo "check-custom-page-imports-declared: $PANEL 不见了；闸门没有对象了"; exit 2; }
[ -d "$VENDOR" ] || { echo "check-custom-page-imports-declared: $VENDOR 不见了；闸门没有对象了"; exit 2; }

# 面板宣传的包名。用 grep -o 取整个 @standmeet/xxx，不靠"下一个字符"分类
# （[[lookahead-rule-eats-the-neighbour]]）。
advertised=$(grep -o '@standmeet/[a-z0-9-]*' "$PANEL" | sort -u)
[ -n "$advertised" ] || {
  echo "check-custom-page-imports-declared: $PANEL 里一个 @standmeet/* 都没提到。"
  echo "         这条闸门存在的理由就是那份清单；清单空了它就什么也没在守。"
  exit 1
}

fail=0
for pkg in $advertised; do
  name=${pkg#@standmeet/}
  if [ ! -d "$VENDOR/$name" ]; then
    echo "check-custom-page-imports-declared: 面板宣传了 $pkg，但 builder 没 vendor 它"
    echo "         owner 照着写 → 构建 module not found → 他以为是自己写错了。"
    fail=1
  fi
done

# 自证：闸门看得见东西吗。造一份提到不存在的包的假面板，它必须红
# （[[gate-can-go-blind]] / [[verifier-can-lie-about-its-own-coverage]]）。
probe=$(mktemp -d)
printf "import '@standmeet/definitely-not-vendored';\n" > "$probe/panel.ts"
probe_hits=$(grep -o '@standmeet/[a-z0-9-]*' "$probe/panel.ts" | sort -u)
if [ "$probe_hits" != "@standmeet/definitely-not-vendored" ]; then
  echo "check-custom-page-imports-declared: 自证失败 —— 提取器没读到探针里的包名"
  rm -rf "$probe"
  exit 2
fi
if [ -d "$VENDOR/definitely-not-vendored" ]; then
  echo "check-custom-page-imports-declared: 自证失败 —— 探针包居然存在"
  rm -rf "$probe"
  exit 2
fi
rm -rf "$probe"

[ "$fail" -eq 0 ] || exit 1
echo "check-custom-page-imports-declared: 面板宣传的每个 @standmeet/* 都在 builder/vendor 里（自证通过）。"
