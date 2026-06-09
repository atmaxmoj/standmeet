// wiki-tree.ts —— admin wiki 列表的树关系小工具。地址是 parent 树派生的、删父
// 级联删子孙(见 backend schema parent_id ON DELETE CASCADE),所以删一条前要
// 知道会连带删掉几条。纯逻辑,放 lib(presentation 层不写 if/循环)。

interface ParentRef {
  id: string;
  parent_id?: string | null;
}

// descendantCounts —— 每个 id → 它的子孙总数(走每条的 parent_id 链上溯,路上
// 每个祖先 +1)。guard 防环路。
export function descendantCounts(rows: readonly ParentRef[]): Record<string, number> {
  const parentOf = new Map<string, string>();
  for (const r of rows) {
    if (r.parent_id) parentOf.set(r.id, r.parent_id);
  }
  const counts: Record<string, number> = {};
  for (const r of rows) {
    let cur = parentOf.get(r.id);
    let guard = 0;
    while (cur !== undefined && guard < 64) {
      counts[cur] = (counts[cur] ?? 0) + 1;
      cur = parentOf.get(cur);
      guard += 1;
    }
  }
  return counts;
}
