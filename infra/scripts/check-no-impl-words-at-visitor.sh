#!/usr/bin/env sh
# check-no-impl-words-at-visitor —— 访客看得见的进度文案里不许出现实现词汇。
#
# 为什么这条闸门存在（UX-55）：
# 访客问「能给我一份可以发给团队的总结吗」，屏幕上的进度提示回他 **`calling plugin`** ——
# 宿主的架构名词。而**同一个产品在 owner 那侧把这件事做对了**：`summarize_conversation` 的
# manifest 有 `title: Summarize the conversation`，dock 下拉透传的就是它，
# dock-buttons 的 check 2 正是因此判绿。
#
# **人话名字一直在，只是没跟到访客那条路上**（[[move-the-capability-move-its-edges]]）。
# 于是修法不是"再加一个 progress_label 字段等人填"—— 那个字段下一个能力照样会忘 ——
# 而是让兜底退到**已经必填、已经被 owner 审过**的 Title。
#
# 这条闸门守的是**类**而不是那一个字符串：progress-label 这条路上不许出现
# plugin / adapter / handler / dispatch 这类只有实现者才用的词。
#
# 自证：把一段种进去的坏兜底喂给同一个判定，必须判红（见 [[gate-can-go-blind]]）。

set -eu

# 只扫真正会成为 throbber 文案的那条路：progress label 的产出点。
#
# 路径相对**仓库根**解析，而不是相对 cwd：这条闸门既从根跑（make lint），也从 backend/ 跑
# （backend/Makefile 的 connector-boundary）。第一版写死相对路径，从 backend/ 跑时找不到文件 ——
# 而它当场报了 "the rule has no subject" 并 exit 2，**没有报绿**。
# 闸门找不到主体时必须炸，不能默默通过（见 [[assertion-that-cannot-fail]]）。
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/backend/internal/capabilities/mcpplugin/progress_label.go"

# IMPL_WORDS —— 只有写这套系统的人才会说的词。owner 面可以出现（他在配这套东西），
# **访客面不行**。故意不含 "tool"：产品在访客面上确实把工具叫 tool（"SEARCHED 2 · READ 5"
# 那条收据），那是已经想过的词汇选择，不是漏出来的实现细节。
IMPL_WORDS='plugin|adapter|handler|dispatcher|dispatch|binding|manifest|sandbox|rpc'

fail=0

# scan —— 在 progress-label 函数体内，找**返回的字面量本身**带实现词的行。
#
# 判定必须只看**行内容**，不能连文件名一起看：第一版把 `FILENAME:FNR:行` 拼好再 grep，
# 而这个文件住在 `internal/capabilities/mcpplugin/` —— **路径里就有 "plugin"**，
# 于是每一行都命中，连正确的 `return "working"` 也被判红。
# 匹配对象比匹配规则更容易搞错（同 [[lookahead-rule-eats-the-neighbour]]：
# 判据把邻居也吃了）。现在 awk 自己做判定，只看 $0。
scan() {
  awk -v words="$IMPL_WORDS" '
    /func ProgressLabel/  { inblock = 1 }
    inblock && /return "/ {
      line = $0
      if (tolower(line) ~ words) { print FILENAME ":" FNR ":" line }
    }
    inblock && /^}/       { inblock = 0 }
  ' "$@"
}

if [ ! -f "$TARGET" ]; then
  echo "check-no-impl-words-at-visitor: $TARGET is gone — the rule has no subject"
  exit 2
fi

offenders=$(scan "$TARGET" || true)
if [ -n "$offenders" ]; then
  echo "check-no-impl-words-at-visitor: a visitor-facing progress label names the implementation:"
  echo "$offenders"
  echo "                 访客要的是「正在发生什么」，不是「宿主怎么实现的」。"
  echo "                 退到 manifest 的 Title —— 它必填，而且 owner 已经审过一遍。"
  fail=1
fi

# 自证 1：判定必须看得见一个种进去的坏兜底。
planted=$(mktemp -t implwords.XXXXXX)
cat > "$planted" <<'PLANTED'
func ProgressLabel(m *Manifest, declared string) string {
	return "calling plugin"
}
PLANTED
if [ -z "$(scan "$planted" || true)" ]; then
  rm -f "$planted"
  echo "check-no-impl-words-at-visitor: SELF-TEST FAILED — the scan cannot see a planted impl word"
  exit 2
fi
rm -f "$planted"

# 自证 2：判定不能把**好**的兜底也判红 —— 一条管太宽的闸门会把代码推去更糟的地方
# （见 [[gate-scope-forces-architecture]]）。
ok=$(mktemp -t implwords-ok.XXXXXX)
cat > "$ok" <<'OKCASE'
func ProgressLabel(m *Manifest, declared string) string {
	return "working"
}
OKCASE
if [ -n "$(scan "$ok" || true)" ]; then
  rm -f "$ok"
  echo "check-no-impl-words-at-visitor: SELF-TEST FAILED — the scan reds a legitimate fallback"
  exit 2
fi
rm -f "$ok"

[ "$fail" -eq 0 ] || exit 1
echo "check-no-impl-words-at-visitor: no implementation vocabulary on the visitor's progress line (both self-tests passed)."
