#!/usr/bin/env sh
# check-one-corpus-href —— 一条语料的公开地址只能有**一个来源**。
#
# 为什么这条闸门存在：这件事以前没有主人，15 个地方各自现拼一遍 `/wiki/…` `/writings/…`
# `/output/…`，而它们互相不一致 —— 有的用 slug、有的用 path、有两处直接写
# `/${genre}/${path}`。最后那一种在 prod 上渲出了一个 404：
#   sijie.xyz/writing/writings/the-business-model-wedge
# 它把**体裁名当成了路由名**（体裁单数 `writing`，路由复数 `/writings/[slug]`），
# 而那条 writing 的语料 path 本身又带 `writings/` 前缀，于是叠成两段。
# 那篇是这台实例当时**唯一**一篇公开 writing —— 也就是说整个公开阅读面的入口是坏的。
#
# 更深的一层：`public.ts` 的 `mapWritingNode` 把 slug 装进了 `path` 字段，于是同一个
# `TreeNode.path`，树接口给的是 slug、引用结果给的是真实路径。**同一个字段名两种含义**，
# 这正是同一个表达式在一块屏上对、在另一块屏上 404 的原因。改名让各处的独立决定
# 「看起来」一致，而它们从来就不一致。
#
# 锁的是**结构**不是字符串：会腐烂的不是某一处拼错，是「谁都可以自己拼」。
# 允许出现的地方只有 `app/src/lib/corpus/href.ts`（映射和寻址标识的唯一住处）。
#
# 自证：把一段种进去的坏写法喂给同一个判定，必须判红；判不红说明扫描器瞎了
# （见 [[gate-can-go-blind]]）。

set -eu

# 只扫**呈现层**（`components/` + `app/`）。
#
# 第一版扫 `app/src` 全部，于是把 `lib/admin/use-writings.ts` 里的
# `adminAPI.patchForm('/writings/${id}')` 也判红了 —— 那是 `/api/admin` 下的**后端路由**，
# 跟公开页地址是两个命名空间，同名只是巧合。闸门管太宽会逼着合法代码绕路
# （见 [[gate-scope-forces-architecture]]）。
#
# 边界是真实的：公开页地址在呈现层拼（href / Link），数据访问层拼的是 API 路径。
SRC="app/src/components app/src/app"
HOME_FILE="app/src/lib/corpus/href.ts"

fail=0

# 1) 家必须在。不在的话下面每一次 import 都是空引用，而闸门会因为"没人违规"而全绿。
if [ ! -f "$HOME_FILE" ]; then
  echo "check-one-corpus-href: $HOME_FILE is missing — the mapping has no home"
  exit 1
fi

# scan —— 在 tsx/ts 里找**手拼的**公开语料地址：模板串或字面量里以 /wiki/ /writings/
# /output/ 开头的一段。stdin 收文件名，命中即打印。
#
# 只看 href/Link 那一类用法会漏（有人先算进变量再传），所以判的是**这三个前缀出现在
# 一段被拼接的字符串里**这个形状本身。
# drop_comments —— 注释里提到旧写法是**说明**，不是违规。第一版把解释这条缺陷的那句注释
# 判红了：闸门要是连"讲这件事"都不许，正确的做法就没法被写下来。
drop_comments() {
  grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' || true
}

scan() {
  grep -nE "(\`|')/(wiki|writings|output)/\\\$\{" "$@" 2>/dev/null | drop_comments
}

offenders=$(find $SRC \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 -r grep -nE "(\`|')/(wiki|writings|output)/\\\$\{" 2>/dev/null | drop_comments)

if [ -n "$offenders" ]; then
  echo "check-one-corpus-href: a corpus URL is hand-built instead of going through corpusHref():"
  echo "$offenders"
  echo "  → import { corpusHref } from '@/lib/corpus/href'"
  echo "     wiki/output 按 path 寻址，writings 按 slug —— 那个分歧只住在 href.ts 里。"
  fail=1
fi

# 2) `/${genre}/…` —— 把体裁名当路由名的那一种，形状跟上面不同，单独扫。
#    它是那个 404 的直接成因，而且它**看起来最像对的**：三种体裁里有两种碰巧成立。
genre_join=$(find $SRC \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 -r grep -nE '\`/\$\{[a-zA-Z_.]*genre[a-zA-Z_.]*\}/' 2>/dev/null | drop_comments)

if [ -n "$genre_join" ]; then
  echo "check-one-corpus-href: a URL is built from a genre string — the genre is NOT the route:"
  echo "$genre_join"
  echo "  → writing → /writings（单数体裁、复数路由）。这条映射只住在 href.ts 里。"
  fail=1
fi

# 3) 自证：种一个坏写法，同一个判定必须看得见它。
planted=$(mktemp -t corpushref.XXXXXX)
mv "$planted" "$planted.tsx"
planted="$planted.tsx"
cat > "$planted" <<'PLANTED'
export function Planted({ node }: { node: { path: string } }) {
  return <a href={`/wiki/${node.path}`}>planted</a>;
}
PLANTED
if [ -z "$(scan "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-corpus-href: SELF-TEST FAILED — the scan cannot see a planted hand-built URL"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-corpus-href: one corpus-href source (self-test passed: a planted hand-built URL goes red)."
