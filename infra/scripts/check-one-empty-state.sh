#!/usr/bin/env sh
# check-one-empty-state —— admin 的列表空态只能从 ListPane 里出来。
#
# 为什么这条闸门存在(F-N-7):在这之前,每个 section 自己写
#     hook.list.length === 0 ? <空态/> : <列表/>
# 这句话只有两种结局,而真实世界有三种 —— **拉失败之后列表也是空数组**,于是失败穿上空态的
# 衣服。prod 上真驱出来的样子:`/admin/roles` 印着「No roles yet」而那台实例有三个角色;
# `/admin/ip-bans` 更狠 ——「No IPs banned. The public surface is open」。
#
# 空态说的是**一句关于世界的话**,而且总是指向一个动作(`+ NEW ROLE`)。失败时说它,owner 会在
# 一份自己没读到的配置上面动手。
#
# **产品里已经有人做对过**(`CodeCorpusConfig` 的 `CorpusLoadFailed`、`CapabilitiesPanel` 判
# `status === 'error'`)—— 做对的方式是**手写第三种状态**。手写就意味着下一个 section 还会漏:
# 需要人记得的检查就是一个职责类(见 [[structure-means-no-responsibility-class]])。
# 所以这里锁的是「有没有绕过 ListPane」,不是「记不记得加 error 分支」。
#
# **判定的形状,两个条件都要满足**:
#   (a) `length === 0` 后面跟着一个 `? <大写开头的组件` —— 用条数决定渲染哪个组件;
#   (b) **同一个文件里有加载状态**(`ResourceStatus` / `.status ===` / `hook.status`)。
#
# 为什么要 (b):第一版只查 (a),扫出三处**误报** —— `MembersBlock` 用的是另一套判别联合
# (`state.kind`,error 已经单独处理过了)、`PinManager` 的 pins 是 owner 正在编辑的表单值、
# `NeedsList` 的 items 是从手里已有的 stats 推出来的。这三处的空态都是**真结论**,不是没拉到。
# 给它们逐个开豁免是错的路 —— 豁免会腐烂,而且一条挡住正当写法的规则会把代码推去更糟的地方
# (见 [[gate-scope-forces-architecture]])。(b) 才是这条规矩真正的边界:
# **手里有加载状态,就没有理由自己决定空态。**
#
# `? null` 也放过:什么都不渲染不是一句关于世界的陈述,那是可选装饰(整段没内容时不出标题)。
#
# 自证:种一段「有 status 又手写空态」的必须判红;种一个「没有 status」的和一个 `? null` 的
# 都必须放过 —— 只判红不判绿的闸门等于没验过它的边界。

set -eu

OWNER="app/src/components/admin/ListPane.tsx"
SCOPE="app/src/components/admin/sections"

fail=0

# shape_hits —— 条件 (a):找「用条数挑组件」的写法。注释行跳过:这几个文件的顶部注释正在讲
# 这段历史,把它们判红会逼人删掉解释。`? null` / `? <空片段` 放过。三元跨行的看下一行。
shape_hits() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    /length === 0/ {
      line = $0
      if (line ~ /length === 0[[:space:]]*\?[[:space:]]*</) {
        if (line !~ /\?[[:space:]]*<>/) { print FILENAME ":" FNR ":" line }
        next
      }
      if (line ~ /length === 0$/) { pending = FILENAME ":" FNR ":" line; next }
      next
    }
    pending != "" {
      if ($0 ~ /^[[:space:]]*\?[[:space:]]*<[A-Z]/) { print pending }
      pending = ""
    }
  ' "$@"
}

# has_status —— 条件 (b):这个文件手里有加载状态吗。单独一遍,不塞进 awk ——
# awk 是单遍扫描,而状态的声明可能出现在犯规那一行**之后**。
has_status() {
  grep -qE 'ResourceStatus|\.status ===|hook\.status|status=\{' "$1"
}

# scan_empties —— (a) 且 (b)。这才是这条规矩的边界:手里有加载状态,就没有理由自己决定空态。
scan_empties() {
  for f in "$@"; do
    has_status "$f" || continue
    shape_hits "$f"
  done
}

files=$(find "$SCOPE" -name '*.tsx' -type f 2>/dev/null || true)

# 1) 扫描器必须真的看得见文件 —— 空列表会让下面的判定恒绿(见 [[assertion-that-cannot-fail]])。
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 15 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — only $n tsx files under $SCOPE, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files 是换行分隔的路径列表,这里要的就是词分割
offenders=$(scan_empties $files || true)

if [ -n "$offenders" ]; then
  echo "check-one-empty-state: 用条数直接挑组件 —— 失败之后列表也是空的,这句空话会被 owner 当真:"
  echo "$offenders"
  echo "                       用 <ListPane status=… count=… empty={…}> ($OWNER)。"
  fail=1
fi

# 2) 组件本身必须还在,而且里面那个顺序还在 —— 否则上面那条恒绿。
if [ ! -f "$OWNER" ]; then
  echo "check-one-empty-state: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q "status === 'error'" "$OWNER"; then
  echo "check-one-empty-state: $OWNER no longer branches on the error status — the whole point is that order"
  fail=1
fi

# 3) 自证:三样都要验 —— 判得出红,也判得出这两种绿。只验红的闸门没验过自己的边界,
#    而这条闸门的第一版正是因此扫出三处误报。
guilty=$(mktemp -t emptycheck.XXXXXX)
cat > "$guilty" <<'PLANTED'
import type { ResourceStatus } from '@/lib/state/status';
export function Bad({ rows }) {
  return rows.length === 0
    ? <EmptyRows />
    : <RowList rows={rows} />;
}
export function AlsoBad({ tags }) {
  return tags.length === 0 ? <EmptyTags /> : <TagList tags={tags} />;
}
export function Fine({ tags }) {
  return tags.length === 0 ? null : <TagList tags={tags} />;
}
PLANTED
# 没有加载状态的那种:同样的形状,但这个列表是从手里的数据推出来的(PinManager / NeedsList)。
derived=$(mktemp -t emptycheck.XXXXXX)
cat > "$derived" <<'PLANTED'
export function Derived({ items }) {
  return items.length === 0 ? <EmptyAction /> : <NeedRows items={items} />;
}
PLANTED
guilty_hits=$(scan_empties "$guilty" | grep -c . || true)
derived_hits=$(scan_empties "$derived" | grep -c . || true)
rm -f "$guilty" "$derived"
if [ "$guilty_hits" -ne 2 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — expected 2 planted offenders (the '? null' one let through), saw $guilty_hits"
  exit 2
fi
if [ "$derived_hits" -ne 0 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — a list with no load status in scope must be let through, saw $derived_hits"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-empty-state: an empty state only comes from ListPane ($n section files scanned; self-test passed)."
