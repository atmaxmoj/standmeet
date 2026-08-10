#!/usr/bin/env sh
# check-peek-signals-more —— 一张**会被切**的预览卡，切口处必须有续读信号。
#
# 为什么这条闸门存在（UX-56）：
# summarize 的报告卡是**有意**的 sneak-peek —— 内层 iframe 写死 280px，超出的报告就被切。
# 但切口原本什么信号都没有：正文断在句子中间撞上卡片边框，读起来像"坏了"而不是"还有"。
# 续读入口（`open as page ↗`）一直在头部，缺的只是"你需要走它"这件事被说出来。
#
# **这条闸门能挡什么、不能挡什么，说清楚**：
#   能挡 —— 有人把渐隐那条规则**删掉**（最现实的回归：重构卡片样式时顺手带走）。
#   不能挡 —— 有人把渐变改成 transparent→transparent 这类**削弱**。
# 一条只挡得住"被删"的闸门仍然值得有，但把它说成"保证切口一直有信号"就是撒谎。
# （e2e 那边试过：伪元素没有 locator，量卡片高度根本测不到渐隐 ——
#  那种断言看着像在守，其实永远不会红，见 [[assertion-that-cannot-fail]]。所以守在源头。）
#
# 自证：把去掉渐隐的模板喂给同一个判定，必须判红。

set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/mcp-servers/summarize/content.go"

fail=0

if [ ! -f "$TARGET" ]; then
  echo "check-peek-signals-more: $TARGET is gone — the rule has no subject"
  exit 2
fi

# scan —— 卡片模板里，固定高度的预览 iframe 必须**同时**存在一条覆盖切口的渐隐。
# 两个条件一起判：只有渐隐没有固定高度 = 这条规则已经没有对象了，也该有人来看一眼。
#
# **判定要跨行**：真实模板里 `.card::after{...}` 和它的 `linear-gradient` 分在两行 ——
# 第一版用按行的 `grep -qE` 一起找这两样，于是**正确的模板也被判红**，
# 而且连自证 2（"带渐隐的不许红"）都跟着炸了。自证救了这一次：
# 如果只写自证 1，这个瞎判会带着一句绿色的谎言上线（[[gate-can-go-blind]]）。
# 所以先把整份文件读成一行再判规则块。
has_fixed_peek() { tr '\n' ' ' < "$1" | grep -qE 'iframe *\{[^}]*height: *[0-9]+px'; }
has_fade()       { tr '\n' ' ' < "$1" | grep -qE '\.card::after *\{[^}]*linear-gradient'; }

if has_fixed_peek "$TARGET" && ! has_fade "$TARGET"; then
  echo "check-peek-signals-more: the report card clips at a fixed height with nothing at the cut."
  echo "                 一个必然被切的预览，切口处要有续读信号（渐隐），"
  echo "                 否则正文断在句子中间读起来像坏了，而不是像"还有"。"
  fail=1
fi

# 自证 1：去掉渐隐的模板必须判红。
planted=$(mktemp -t peek.XXXXXX)
cat > "$planted" <<'PLANTED'
 .card{border:1px solid #d9d0c2;overflow:hidden}
 iframe{width:100%;height:280px;border:none}
PLANTED
if ! { has_fixed_peek "$planted" && ! has_fade "$planted"; }; then
  rm -f "$planted"
  echo "check-peek-signals-more: SELF-TEST FAILED — a template with no fade is not seen"
  exit 2
fi
rm -f "$planted"

# 自证 2：带渐隐的模板不许判红（管太宽的闸门会把代码推去更糟的地方）。
ok=$(mktemp -t peek-ok.XXXXXX)
cat > "$ok" <<'OKCASE'
 .card{border:1px solid #d9d0c2;overflow:hidden;position:relative}
 .card::after{content:"";position:absolute;bottom:1px;height:56px;
   background:linear-gradient(to bottom,rgba(255,255,255,0),#fff);pointer-events:none}
 iframe{width:100%;height:280px;border:none}
OKCASE
if has_fixed_peek "$ok" && ! has_fade "$ok"; then
  rm -f "$ok"
  echo "check-peek-signals-more: SELF-TEST FAILED — a template WITH a fade is red"
  exit 2
fi
rm -f "$ok"

[ "$fail" -eq 0 ] || exit 1
echo "check-peek-signals-more: the clipped preview carries a fade at the cut (both self-tests passed)."
