#!/usr/bin/env sh
# check-one-select —— 全 app 只有**一个**下拉,它在 SelectField 里面。
#
# 为什么这条闸门存在(UX-47):在这之前 19 个 `<select>` 有**五种**互不知道的写法 ——
# 盒子边框 / 小盒子 / 下划线 / sm-field-input / gate 那个近黑实心(UX-36 说它是全页最重的
# 色块)。这不是"某几处漏改",而是**没有这一层**,于是每个面各自决定下拉长什么样。
#
# 光加一个 `.sm-select` 类不解决问题:类名要靠人记得贴,而**下一个写下拉的人不会知道它
# 存在** —— 那正是前面五种写法的来历。所以闸门锁的不是"贴了没",是"有没有绕过组件":
# `app/src` 里除了 SelectField 自己,不许再出现 `<select`。
# (见 [[reframes-tasks-into-enforced-invariants]]:把错误变得做不出来,胜过把错误说清楚。)
#
# 自证:把一段种进去的坏写法喂给**同一个判定**,必须判红 —— 判不红说明扫描器瞎了
# (见 [[gate-can-go-blind]]:`grep --include` 在 alpine 上会静默失明,所以这里不用它)。

set -eu

OWNER="app/src/components/atoms/SelectField.tsx"

fail=0

# scan_selects —— 在给定的文件列表里找 JSX 里的裸 `<select`。stdin 不收,参数收文件名。
# **注释里的 `<select` 不算** —— 这几个文件的顶部注释在讲这段历史,把它们判红会逼人删掉
# 解释(见 [[gate-scope-forces-architecture]]:管太宽的闸门会把代码推去更糟的地方)。
scan_selects() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*)/ { next }   # 整行注释:跳过
    /<select/                     { print FILENAME ":" FNR ":" $0 }
  ' "$@"
}

files=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -v "^$OWNER$" || true)

# 1) 扫描器必须真的看得见文件 —— 空列表会让下面的判定恒绿(见 [[assertion-that-cannot-fail]])。
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-select: SELF-TEST FAILED — only $n tsx files in scan range, the scan is blind"
  exit 2
fi

offenders=$(printf '%s\n' "$files" | xargs -r awk '
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /<select/                     { print FILENAME ":" FNR ":" $0 }
' || true)

if [ -n "$offenders" ]; then
  echo "check-one-select: a bare <select> bypasses SelectField —— 下拉只能有一种长相:"
  echo "$offenders"
  echo "                  用 <SelectField> ($OWNER)。"
  fail=1
fi

# 2) 组件本身必须还在,而且里面确实有那一个 select —— 否则上面那条恒绿。
if [ ! -f "$OWNER" ]; then
  echo "check-one-select: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q '<select' "$OWNER"; then
  echo "check-one-select: $OWNER no longer renders a <select>"
  fail=1
fi

# 3) 自证:种一个坏调用点,同一个判定必须看得见它。
planted=$(mktemp -t selcheck.XXXXXX)
cat > "$planted" <<'PLANTED'
export function Planted() {
  return <select><option value="x">x</option></select>;
}
PLANTED
if [ -z "$(scan_selects "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-select: SELF-TEST FAILED — the scan cannot see a planted bare <select>"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-select: one select, and it lives in SelectField ($n tsx files scanned; self-test passed)."
