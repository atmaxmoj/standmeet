#!/usr/bin/env sh
# check-sm-class-defined —— 每一个写进 tsx 的 `sm-*` 类名,CSS 里必须真的有它。
#
# 为什么这条闸门存在:
# 这套设计语言的动作按钮全靠 `.sm-btn` + 一个 variant(`-solid` / `-outline` / `-ghost` /
# `-accent` / `-danger`)。**写错 variant 不会报错** —— tsx 里 className 是个字符串,
# 打错的那半截什么都不匹配,浏览器对未知类名不吭声,tsc 和 eslint 都不管 CSS。
# 于是按钮**静默退回裸 `.sm-btn`**:透明底、无边框、11px 等宽小字。
#
# 它不是"样式差一点",是主次颠倒:
#   - `/admin/seo` 的 `SAVE` 挂着 `sm-btn-primary`(不存在的 variant),渲染得**比它旁边
#     那两个「跳去别处编辑」的次要链接还轻** —— 设计评审当成排版问题记了一条 UX-74②,
#     真正的原因是这个类名一条 CSS 都不生成。
#   - `SessionStrip` 的 "N / M names" 用 `sm-session-strip-members-used` 强调那个 N,
#     而定义只有 `sm-session-strip-used`(配额那条用的)。于是同一条栏上,
#     turns 的数字是墨色/告警朱红,names 的数字什么都不是。
#
# 跟 [[computed-class-generates-nothing]] 同一族:**名字在,规则不在,没有任何工具会报错**。
# 那条闸门管的是插值,这条管的是**拼错/从未定义**。两条合起来才覆盖"类名什么都不生成"。
#
# 扫描口径(每一条都是刻意的,改动前先读):
#   - 只扫 tsx —— className 只会出现在那里。`.ts` 里的 `sm-session-changed` 是事件名,不是类。
#   - 去掉 `--sm-*`:那是 CSS 变量引用(`var(--sm-scrim)`),不是类名。
#   - 去掉后面紧跟 `.` 的:注释里的文件名(`sm-components.js` / `sm-tokens.css`)。
#
# 自证(见 [[gate-can-go-blind]] / [[assertion-that-cannot-fail]]):
#   扫描范围不能为空;种一个未定义类必须被抓;两条排除规则不能过宽也不能过窄。

set -eu

SRC=app/src

# strip_noise —— 从一段 tsx 里滤掉"看起来像类名但不是"的东西。
#   1. 整行注释(`//` / `*` 开头):注释里会**讨论**类名 —— 比如 Btn.tsx 里解释
#      `sm-btn-primary` 为什么不存在。className 从不写在整行注释里。
#   2. `--sm-*`:CSS 变量引用。
#   3. 末尾带 `.` 的:注释里的文件名(`sm-components.js`)。
strip_noise() {
  grep -vE '^[[:space:]]*(//|\*)' \
    | sed 's/--sm-[a-z0-9-]*//g' \
    | grep -oE 'sm-[a-z0-9-]+\.?' \
    | grep -v '\.$'
}

extract_used() {
  find "$SRC" -name '*.tsx' -type f -print0 2>/dev/null \
    | xargs -0 -r cat \
    | strip_noise \
    | sort -u
}

extract_defined() {
  find "$SRC" -name '*.css' -type f -print0 2>/dev/null \
    | xargs -0 -r grep -hoE '\.sm-[a-z0-9-]+' \
    | cut -c2- \
    | sort -u
}

# 进程替换 `<(...)` 和 `grep --include` 都是 bash/GNU 的东西,而这套闸门也在 alpine 镜像里跑
# (busybox 的 sh/grep 会**静默**当成别的意思 —— 见 [[gate-can-go-blind]])。全程走真实临时文件
# + find/xargs。
deffile=$(mktemp -t smclassdef.XXXXXX)
used=$(extract_used)
extract_defined > "$deffile"
defined=$(cat "$deffile")
missing=$(printf '%s\n' "$used" | grep -vxF -f "$deffile" || true)
rm -f "$deffile"

# ── 自证 1:扫描范围 ──────────────────────────────────────────────────
ntsx=$(find "$SRC" -name '*.tsx' -type f 2>/dev/null | grep -c . || true)
ndef=$(printf '%s\n' "$defined" | grep -c . || true)
if [ "$ntsx" -lt 50 ] || [ "$ndef" -lt 50 ]; then
  echo "check-sm-class-defined: SELF-TEST FAILED — $ntsx tsx / $ndef defined classes in range, the scan is blind"
  exit 2
fi

# ── 自证 2:判定 + 三条排除规则 ──────────────────────────────────────
# 四个种子的名字**互不为子串** —— 否则 `case` 的通配会互相误判(第一版就栽在这:
# `sm-btn-plantedvariant` 里含 `plantedvar`,排除规则的断言被自己的种子喂绿了)。
plant=$(mktemp -t smclass.XXXXXX)
{
  printf '<button className="sm-btn sm-btn-plantedclass" />\n'
  printf '<div className="fixed bg-[var(--sm-seededtoken)]" />\n'
  printf '// see docs/design/project/sm-quotedpath.js:12\n'
  printf '// 两套词汇正是 `sm-discussedname` 的来源\n'
} > "$plant"
seen=$(strip_noise < "$plant" | sort -u)
rm -f "$plant"
case "$seen" in *sm-btn-plantedclass*) ;; *)
  echo "check-sm-class-defined: SELF-TEST FAILED — planted undefined class was not seen"; exit 2 ;;
esac
case "$seen" in *seededtoken*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a --sm-* css var leaked in as a class"; exit 2 ;;
esac
case "$seen" in *quotedpath*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a filename in a comment leaked in as a class"; exit 2 ;;
esac
case "$seen" in *discussedname*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a class NAMED IN A COMMENT leaked in as a use"; exit 2 ;;
esac

# ── 判定 ─────────────────────────────────────────────────────────────
if [ -n "$missing" ]; then
  echo "check-sm-class-defined: these classes are written into tsx but defined NOWHERE in css."
  echo "                        它们一条 CSS 都不生成 —— 按钮会静默退回裸 .sm-btn:"
  for c in $missing; do
    echo "  $c"
    find "$SRC" -name '*.tsx' -type f -print0 \
      | xargs -0 -r grep -n "$c" \
      | head -4 | while IFS= read -r l; do echo "      $l"; done
  done
  exit 1
fi

echo "check-sm-class-defined: every sm-* class in tsx has a definition ($ntsx tsx files, $ndef classes; self-test passed)."
