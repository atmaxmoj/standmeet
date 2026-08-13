#!/usr/bin/env sh
# check-one-text-input —— 文本输入只有**一种**长相:下划线(`.sm-field-input`)。
#
# 为什么这条闸门存在(UX-59):同一种控件在这个产品里长了两种样子 —— 连接器凭据、
# 连接器 op 参数、SEO 的两个字段是**整框**(四边边框 + 圆角 + 内距),而 codes 新建弹窗、
# 简历 composer、gate、AI provider 面板里的输入是**下划线**。owner 隔一屏就换一套标准。
#
# 这跟 UX-47(下拉五种写法)是同一个失败形状,而那一条的教训是:**光有一个类不够**。
# `.sm-field-input` 一直存在,新写输入框的人不知道它存在,于是各自决定长什么样。
# 所以闸门锁的不是"贴了没",是**"有没有绕过它"**:`<input>` 上不许再手抄四边框。
# (见 [[reframes-tasks-into-enforced-invariants]]:把错误变得做不出来。)
#
# 只管 `<input>`,不管卡片/容器 —— `border … rounded` 在卡片上是对的,这条规则**只针对
# 输入控件**。判据取 `<input` 起到 `/>` 或 `>` 止的那一段(JSX 里属性常跨行)。
#
# 例外:只读展示框(`readOnly`)不是输入,它是"把一个值印出来给你抄",框着反而对。
#
# 自证:种一个手抄整框的 input 必须判红;种一个带 readOnly 的必须放过;
# 扫描范围不能为空(见 [[gate-can-go-blind]] / [[assertion-that-cannot-fail]])。

set -eu

SRC=app/src

# scan_boxed —— 逐文件把每个 `<input …>` 折成一行,再看这一行里有没有四边框。
# 整行注释跳过(注释里会**讨论**这段历史,判红会逼人删掉解释)。
scan_boxed() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
    /<input/ { collecting = 1; buf = ""; start = FNR }
    collecting { buf = buf " " $0 }
    collecting && /\/>|<\/input>/ {
      collecting = 0
      if (buf ~ /readOnly/)                       next
      if (buf ~ /border border-\(--color-rule\)/) print FILENAME ":" start ":" buf
    }
  ' "$@"
}

files=$(find "$SRC" -name '*.tsx' -type f 2>/dev/null || true)
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-text-input: SELF-TEST FAILED — only $n tsx files in range, the scan is blind"
  exit 2
fi

# 自证:一个坏写法必须被看见,一个 readOnly 展示框必须被放过。
plant=$(mktemp -t textinput.XXXXXX)
cat > "$plant" <<'PLANTED'
export function Planted() {
  return (
    <>
      <input
        type="text"
        className="w-full border border-(--color-rule) rounded-sm p-2"
      />
      <input
        readOnly
        value="/api/x/callback"
        className="w-full border border-(--color-rule) rounded-sm p-2"
      />
    </>
  );
}
PLANTED
hits=$(scan_boxed "$plant" | grep -c . || true)
rm -f "$plant"
if [ "$hits" != "1" ]; then
  echo "check-one-text-input: SELF-TEST FAILED — saw $hits/1 (a boxed input must go red, a readOnly one must pass)"
  exit 2
fi

offenders=$(printf '%s\n' "$files" | xargs -r awk '
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /<input/ { collecting = 1; buf = ""; start = FNR }
  collecting { buf = buf " " $0 }
  collecting && /\/>|<\/input>/ {
    collecting = 0
    if (buf ~ /readOnly/)                       next
    if (buf ~ /border border-\(--color-rule\)/) print FILENAME ":" start
  }
' || true)

if [ -n "$offenders" ]; then
  echo "check-one-text-input: a hand-rolled boxed <input> —— 文本输入只有一种长相:"
  echo "$offenders"
  echo "                      用 className=\"sm-field-input\"(要等宽再加 sm-mono)。"
  exit 1
fi

echo "check-one-text-input: one text-input look ($n tsx files scanned; self-test passed on both the boxed and the readOnly seed)."
