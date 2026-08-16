#!/usr/bin/env sh
# check-one-section-heading —— 后台「一节的标题」只有一种,它从 AdminSectionHead 里出来。
#
# 为什么这条闸门存在(UX-79):在这之前,同一级别的标题在 admin 里有**四种**互不知道的写法 ——
# `.sm-section-h` 的 div、`.sm-smallcaps` 的 div(system 的五张卡)、mono 10.5px uppercase 的
# h3(calendar)、kicker + 大号衬线 h3(capabilities);connectors 那一页的两组干脆没有标题。
# 每补一页就是"记得也给它加一个",于是每次都漏下一页。
#
# **为什么先前加不了闸门**:大节标题和字段名在 DOM 里是同一种形状(mono + 小号 + uppercase),
# 旧签名 `tracking-[0.18em]` 在 app/src 里有一百多处 —— 按形状扫只会扫出噪声。**先有组件,
# 类名才成为可查的签名**;这条闸门锁的是"有没有绕过组件",不是"贴没贴类"。
# (见 [[reframes-tasks-into-enforced-invariants]]。)
#
# 自证:种一段绕过组件的写法喂给**同一个判定**,必须判红 —— 判不红说明扫描器瞎了
# (见 [[gate-can-go-blind]]:`grep --include` 在 alpine 上会静默失明,所以这里不用它)。

set -eu

OWNER="app/src/components/admin/AdminSectionHead.tsx"
CSS="app/src/app/sm-atoms.css"

fail=0

# scan_heads —— 找 `.sm-section-h` 的裸用法。注释里提到类名不算 —— 这几个文件的顶部注释
# 正在讲这段历史,把它们判红会逼人删掉解释(见 [[gate-scope-forces-architecture]])。
scan_heads() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    /sm-section-h/                         { print FILENAME ":" FNR ":" $0 }
  ' "$@"
}

files=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -v "^$OWNER$" || true)

# 1) 扫描器必须真的看得见文件 —— 空列表会让下面的判定恒绿(见 [[assertion-that-cannot-fail]])。
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-section-heading: SELF-TEST FAILED — only $n tsx files in scan range, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files 是换行分隔的路径列表,这里要的就是词分割
offenders=$(scan_heads $files || true)

if [ -n "$offenders" ]; then
  echo "check-one-section-heading: .sm-section-h 绕过了 AdminSectionHead —— 一节的标题只能有一种长相:"
  echo "$offenders"
  echo "                           用 <AdminSectionHead> ($OWNER)。"
  fail=1
fi

# 2) 组件和类本身必须还在 —— 否则上面那条恒绿(组件被删掉时闸门要喊,而不是安静通过)。
if [ ! -f "$OWNER" ]; then
  echo "check-one-section-heading: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q 'sm-section-h' "$OWNER"; then
  echo "check-one-section-heading: $OWNER no longer renders .sm-section-h"
  fail=1
fi

if ! grep -q '^\.sm-section-h' "$CSS"; then
  echo "check-one-section-heading: .sm-section-h is no longer defined in $CSS"
  fail=1
fi

# 3) 自证:种一个绕过组件的调用点,同一个判定必须看得见它。
planted=$(mktemp -t headcheck.XXXXXX)
cat > "$planted" <<'PLANTED'
export function Planted() {
  return <div className="sm-section-h mb-3">deployment</div>;
}
PLANTED
if [ -z "$(scan_heads "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-section-heading: SELF-TEST FAILED — the scan cannot see a planted bare .sm-section-h"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-section-heading: one section heading, and it lives in AdminSectionHead ($n tsx files scanned; self-test passed)."
