#!/usr/bin/env sh
# check-one-time-format —— 时间只有**三种**写法,全部住在 `lib/ui/format-time.ts` 里。
#
# 为什么这条闸门存在(UX-46):owner 一次会话经过的三个面上出现了三种写法 ——
# transcript 模态 `8/8/2026, 10:16:07 AM`(美式 locale + 秒 + AM/PM)、dashboard 的
# 「最近来访」`2026-08-07T01:09:14Z`(ISO + Z,给机器看的)、同页标题 `last refresh · now`。
# 成因跟 UX-47(下拉五种写法)/ UX-59(输入框两种长相)一样:**没有这一层**,
# 于是 `toISOString().slice(0,10)` 被复制了四份,`toLocaleString()` 两份。
#
# 三种写法各自回答一个不同的问题(多新 / 哪一刻 / 哪一天),所以是三个函数不是一个参数。
# 新的显示需求先问「是不是这三种之一」;真不是,就往 format-time.ts 里加第四个,
# **不要**在调用点现写一个。
#
# 只管**显示**:`toISOString()` 在传参/存储/比较里是对的(那是给机器的),所以判据限定在
# 组件与 lib 的显示路径 —— 具体做法是只看 `toLocaleString` / `toLocaleDateString` /
# `toLocaleTimeString` / `toISOString().slice`,前三个只可能是显示,第四个是那份被复制四次的写法。
#
# `Number.toLocaleString()`(给数字加千分位)不在此列 —— 那不是时间。判据靠**日期方法名**
# 和 `.slice`,不靠 `toLocaleString` 本身,否则会把 `rawCount.toLocaleString()` 一起判红。
#
# 自证:种四种坏写法要全被看见,种一个数字千分位必须放过;扫描范围不能为空。

set -eu

SRC=app/src
OWNER="$SRC/lib/ui/format-time.ts"

# DOC_OWNER —— **简历 PDF 上的日期**,不是后台 chrome。那份 PDF 是印给招聘方看的文档,
# `August 13, 2026` 在文档上是对的,而在后台列表里是错的 —— 两套读者,两套写法,
# 所以它有自己的 owner 文件。豁免只给这一个文件:`resume-page/` 下的其它文件照样受管
# (见 [[gate-scope-forces-architecture]]:整目录豁免会把该管的一起放走)。
DOC_OWNER="$SRC/components/admin/resume-page/format.ts"

# PATTERN —— 只认日期专用方法 + 那份被复制的 `toISOString().slice`。
PATTERN='toLocaleDateString|toLocaleTimeString|new Date\([^)]*\)\.toLocaleString|toISOString\(\)\.slice'

scan() {
  grep -nE "$PATTERN" "$@" 2>/dev/null || true
}

files=$(find "$SRC" -name '*.tsx' -o -name '*.ts' \
  | grep -v "^$OWNER$" | grep -v "^$DOC_OWNER$" || true)
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-time-format: SELF-TEST FAILED — only $n source files in range, the scan is blind"
  exit 2
fi

# 自证:四种坏写法全中,数字千分位放过。
plant=$(mktemp -t timefmt.XXXXXX)
cat > "$plant" <<'PLANTED'
const a = d.toLocaleDateString('en-US');
const b = d.toLocaleTimeString([], { hour: '2-digit' });
const c = new Date(iso).toLocaleString();
const e = new Date(iso).toISOString().slice(0, 10);
const ok = rawCount.toLocaleString();
PLANTED
hits=$(scan "$plant" | grep -c . || true)
rm -f "$plant"
if [ "$hits" != "4" ]; then
  echo "check-one-time-format: SELF-TEST FAILED — saw $hits/4 planted formats (a number's toLocaleString must pass)"
  exit 2
fi

if [ ! -f "$OWNER" ]; then
  echo "check-one-time-format: $OWNER is gone; the rule has no owner"
  exit 1
fi

offenders=$(printf '%s\n' "$files" | xargs -r grep -nE "$PATTERN" || true)
if [ -n "$offenders" ]; then
  echo "check-one-time-format: a hand-rolled time format —— 时间只有三种写法:"
  echo "$offenders"
  echo "                       用 stampDay / stampMinute / ago ($OWNER)。"
  exit 1
fi

echo "check-one-time-format: one set of time formats ($n files scanned; self-test passed on all four seeds)."
