#!/usr/bin/env sh
# check-css-parses —— 每个 CSS 文件都必须**解析得动**。
#
# 为什么这条闸门存在:我把一段注释写坏了(提前 `*/`,后面四行变成裸文本),`make lint` 全绿、
# 提交进去了,直到 `app-build` 才炸 —— 因为 lint 链里**没有一步会解析 CSS**:
# `next lint` 只看 JS/TSX,`tsc` 只看类型,两条自证闸门只做文本扫描。
# 于是「工具全绿、产物是坏的」又发生了一次(上一次是 Tailwind 简写不产出规则)。
#
# 这里只做一件小事:**平衡检查**。不是完整的 CSS parser,而是抓住最常见、最静默的那类错 ——
# 注释和花括号没配平。它便宜(毫秒级)、不需要 node_modules、可以放在 lint 链最前面。
#
# 自证:种一段提前闭合的注释,判定必须看得见。

set -eu

fail=0

for f in $(find app/src -name '*.css' 2>/dev/null); do
  # 注释配平:`/*` 与 `*/` 的数量必须相等。
  open_n=$(grep -o '/\*' "$f" | wc -l | tr -d ' ')
  close_n=$(grep -o '\*/' "$f" | wc -l | tr -d ' ')
  if [ "$open_n" != "$close_n" ]; then
    echo "check-css-parses: $f has $open_n '/*' but $close_n '*/' — a comment is unbalanced"
    fail=1
  fi
  # 花括号配平。
  ob=$(grep -o '{' "$f" | wc -l | tr -d ' ')
  cb=$(grep -o '}' "$f" | wc -l | tr -d ' ')
  if [ "$ob" != "$cb" ]; then
    echo "check-css-parses: $f has $ob '{' but $cb '}' — a block is unbalanced"
    fail=1
  fi
done

# 自证:种一个注释配平但**内容跑到注释外**的文件 —— 这正是我犯的那种(总数相等就查不出来),
# 所以自证要证明的是「不平衡的那种查得出来」,并诚实标注这条闸门查不到的那一类。
planted=$(mktemp -t cssparse.XXXXXX)
printf '/* one\n:root { --a: 1; }\n' > "$planted"
po=$(grep -o '/\*' "$planted" | wc -l | tr -d ' ')
pc=$(grep -o '\*/' "$planted" | wc -l | tr -d ' ')
rm -f "$planted"
if [ "$po" = "$pc" ]; then
  echo "check-css-parses: SELF-TEST FAILED — an unbalanced comment is not detected"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-css-parses: comments and blocks balance (self-test passed: an unclosed comment goes red)."
