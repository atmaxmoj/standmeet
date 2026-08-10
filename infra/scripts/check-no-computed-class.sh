#!/usr/bin/env sh
# check-no-computed-class —— Tailwind 的**任意值方括号里不许出现插值**。
#
# 为什么这条闸门存在:
# Tailwind 在**构建期扫源码**决定生成哪些规则。`[--max-w:${maxWidth}px]` 这种拼出来的类,
# 它扫到的是一个不合法的串,于是**一条 CSS 都不生成** —— 而那串照样进了 HTML。
# 结果是「类名在,规则不在」,变量退回兜底值,**没有任何工具会报错**:
# tsc 看到的是合法模板字符串,eslint 不管 CSS,浏览器对未知类名也不吭声。
#
# 这个失败形状在这份代码里已经出现过四次,而且每次的后果都不是"样式差一点":
#   - `.sm-max-w`  兜底 100%  → **每个模态都是满宽**,`maxWidth` 入参从未生效(UX-48)
#   - `.sm-fill`   兜底 0%    → 简历匹配度条 + 访客配额条**从来没显示过任何数值**
#   - `.sm-pos-abs` 兜底 0,0  → 编辑器气泡工具条**从来没跟随过选区**
# 三个都是 [[names-that-lie]]:界面上有个东西,名字说它在表达某个量,而它一直是常量。
#
# 修法永远是同一个:动态值走 `style={{ '--x': v }}` —— 那是真的内联 CSS,不经过任何扫描。
#
# 自证:两种引号各种一段坏写法,同一个判定都必须看得见 —— 只中一种说明还有一整类是盲区
# (见 [[gate-can-go-blind]]:上一条闸门就因为只认双引号而漏掉了模板字面量里的 z-50)。

set -eu

fail=0

# PATTERN —— className/class 值里,方括号任意值内部出现 `${`。
# 方括号内不允许出现 `]`,所以 `[^]]*` 就够界定"还在这个任意值里面"。
PATTERN='(class|className)=[{]?["`][^"`]*\[[^]]*\$\{'

offenders=$(find app/src -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE "$PATTERN" || true)

if [ -n "$offenders" ]; then
  echo "check-no-computed-class: an interpolated Tailwind arbitrary value generates NO css."
  echo "                         用 style={{ '--x': value }} 传动态值:"
  echo "$offenders"
  fail=1
fi

# 扫描范围自证:文件列表为空会让上面那条恒绿(见 [[assertion-that-cannot-fail]])。
n=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-no-computed-class: SELF-TEST FAILED — only $n tsx files in range, the scan is blind"
  exit 2
fi

# 判定自证:双引号 + 模板字面量,两种都要被看见。
planted=$(mktemp -t compclass.XXXXXX)
{
  printf '<div className="w-full [--max-w:${w}px]" />\n'
  printf '<div className={`sm-fill [--fill:${pct}%%]`} />\n'
} > "$planted"
hits=$(grep -cE "$PATTERN" "$planted" || true)
rm -f "$planted"
if [ "$hits" != "2" ]; then
  echo "check-no-computed-class: SELF-TEST FAILED — saw $hits/2 planted interpolations"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-no-computed-class: no interpolated arbitrary values ($n tsx files; self-test passed on both quote forms)."
