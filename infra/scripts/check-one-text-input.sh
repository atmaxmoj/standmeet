#!/usr/bin/env sh
# check-one-text-input —— 文本输入只有**一种**长相,而且那一种只有一个源头:`.sm-field-input`。
#
# 为什么这条闸门存在(UX-59):同一种控件在这个产品里长了两种样子 —— 连接器凭据、
# 连接器 op 参数、SEO 的两个字段是**整框**(四边边框 + 圆角 + 内距),而 codes 新建弹窗、
# 简历 composer、gate、AI provider 面板里的输入是**下划线**。owner 隔一屏就换一套标准。
#
# 这跟 UX-47(下拉五种写法)是同一个失败形状,而那一条的教训是:**光有一个类不够**。
# `.sm-field-input` 一直存在,新写输入框的人不知道它存在,于是各自决定长什么样。
# 所以闸门锁的不是"贴了没",是**"有没有绕过它"**。
# (见 [[reframes-tasks-into-enforced-invariants]]:把错误变得做不出来。)
#
# **第一版只挡「手抄整框」,于是「手抄下划线」从旁边走过去了**(UX-87):`/admin/roles` 上
# 五个输入各自写 `border-b border-(--color-rule)`,长得像那个类却不是它 —— 五处已经互相不一致
# (`/60` 的边、`py-1` 对 `py-0.5`、三种字号),而且**一个都没有 focus 态**:`.sm-field-input:focus`
# 会把下缘变成墨色,手抄的那五个点进去毫无反应。闸门第二次挡住同类代码,说明缺的是机制而不是
# 提醒([[gate-blocks-twice-means-missing-mechanism]]);所以这一版锁的是**类本身**:
# 文本类 `<input>` 必须带 `sm-field-input`,长相不许再手写。
#
# 只管 `<input>`,不管卡片/容器 —— `border … rounded` 在卡片上是对的,这条规则**只针对
# 输入控件**。判据取 `<input` 起到 `/>` 或 `>` 止的那一段(JSX 里属性常跨行)。
#
# 例外:
#   · 只读展示框(`readOnly`)不是输入,它是"把一个值印出来给你抄",框着反而对。
#   · `type="checkbox"` / `type="radio"` / `type="file"` 不是文本框,它们没有那条下缘。
#   · 没有 `className` 的(测试桩、隐藏域)不参与长相这件事。
#
# 自证:整框的、手抄下划线的都必须判红;readOnly 与 checkbox 必须放过;
# 扫描范围不能为空(见 [[gate-can-go-blind]] / [[assertion-that-cannot-fail]])。

set -eu

SRC=app/src

# RULE —— 同一段判定给自证和真扫描共用。两处各抄一份的话,自证证的就不是真跑的那一段。
RULE='
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /<input/ { collecting = 1; buf = ""; start = FNR }
  collecting { buf = buf " " $0 }
  collecting && /\/>|<\/input>/ {
    collecting = 0
    if (buf ~ /readOnly/)                        next
    if (buf ~ /type="(checkbox|radio|file)"/)    next
    if (buf ~ /className/ == 0)                  next
    if (buf ~ /sm-field-input/)                  next
    if (buf ~ /border border-\(--color-rule\)/)  { print FILENAME ":" start ": hand-rolled box"; next }
    if (buf ~ /border-b border-\(--color-rule\)/){ print FILENAME ":" start ": hand-rolled underline"; next }
  }
'

files=$(find "$SRC" -name '*.tsx' -type f 2>/dev/null || true)
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-text-input: SELF-TEST FAILED — only $n tsx files in range, the scan is blind"
  exit 2
fi

# 自证:两种手抄写法各判红一次,readOnly 与 checkbox 各放过一次。
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
        type="text"
        className="w-full bg-transparent border-b border-(--color-rule) py-1"
      />
      <input
        readOnly
        value="/api/x/callback"
        className="w-full border border-(--color-rule) rounded-sm p-2"
      />
      <input
        type="checkbox"
        className="border-b border-(--color-rule)"
      />
      <input type="text" className="sm-field-input sm-mono" />
    </>
  );
}
PLANTED
hits=$(awk "$RULE" "$plant" | grep -c . || true)
rm -f "$plant"
if [ "$hits" != "2" ]; then
  echo "check-one-text-input: SELF-TEST FAILED — saw $hits/2 (a boxed AND an underlined hand-roll must go"
  echo "                      red; readOnly, checkbox and sm-field-input must pass)"
  exit 2
fi

offenders=$(printf '%s\n' "$files" | xargs -r awk "$RULE" || true)

if [ -n "$offenders" ]; then
  echo "check-one-text-input: a hand-rolled <input> look —— 文本输入只有一种长相,而且只有一个源头:"
  echo "$offenders"
  echo "                      用 className=\"sm-field-input\"(要等宽再加 sm-mono);"
  echo "                      宽度/对齐这类布局照旧写在 className 里,长相不要手抄。"
  exit 1
fi

echo "check-one-text-input: one text-input look, and it comes from sm-field-input ($n tsx files scanned;"
echo "                      self-test passed on the boxed, the underlined, the readOnly and the checkbox seed)."
