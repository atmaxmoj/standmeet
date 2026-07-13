// corpus-tree.ts —— admin 语料列表(raw / wiki / output / writings 四 genre 共用)的
// 树关系 + 摘要净化小工具。地址是 parent 树派生的、删父级联删子孙(见 backend schema
// parent_id ON DELETE CASCADE),所以删一条前要知道会连带删掉几条。纯逻辑,放 lib
// (presentation 层不写 if/循环)。

interface ParentRef {
  id: string;
  parent_id?: string | null;
}

// CorpusTreeNode —— a row plus its depth in the corpus tree + whether it has kids.
export interface CorpusTreeNode<T> {
  row: T;
  depth: number;
  hasChildren: boolean;
}

// buildCorpusForest —— flat rows → a pre-order, depth-annotated list (each root is
// immediately followed by its whole subtree). A row whose parent_id is null / not
// in this set is a root. Siblings keep input order; cycles are guarded and any
// unreached row is appended flat so nothing is ever dropped from the view.
export function buildCorpusForest<T extends ParentRef>(rows: readonly T[]): CorpusTreeNode<T>[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    const pid = r.parent_id;
    if (pid && pid !== r.id && byId.has(pid)) {
      childrenOf.set(pid, [...(childrenOf.get(pid) ?? []), r]);
    } else {
      roots.push(r);
    }
  }
  const out: CorpusTreeNode<T>[] = [];
  const seen = new Set<string>();
  const walk = (node: T, depth: number): void => {
    if (seen.has(node.id) || depth > 64) return;
    seen.add(node.id);
    const kids = childrenOf.get(node.id) ?? [];
    out.push({ row: node, depth, hasChildren: kids.length > 0 });
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const r of rows) {
    if (!seen.has(r.id)) out.push({ row: r, depth: 0, hasChildren: false });
  }
  return out;
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

// cleanCorpusExcerpt —— a corpus note body is the verbatim vault markdown: it can
// lead with a YAML frontmatter block and a `> Parent: [[..]]` backlink line that are
// ALSO parsed into the tags/parent_id fields — duplicated noise if shown raw as a
// preview (that was the "# Tags: [[..]] --- > Parent: [[..]]" dump). Strip the
// structural markdown down to a clean one-line reading preview; the full verbatim
// body is untouched (still shown in the editor).
export function cleanCorpusExcerpt(body: string): string {
  let s = body ?? '';
  // leading YAML frontmatter block: --- ... --- at the very top
  s = s.replace(/^﻿?\s*---\r?\n[\s\S]*?\r?\n---\s*/, '');
  // blockquote lines (`> Parent: [[..]]` backlinks; parent lives in parent_id)
  s = s.replace(/^[ \t]*>.*$/gm, '');
  // ATX heading marks: "## Foo" → "Foo" (keep the text, drop the #'s)
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  // wikilinks: [[target|label]] → label, [[target]] → target
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
  // list bullet marks and bold/italic emphasis marks
  s = s.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
  // collapse all runs of whitespace/newlines to single spaces
  return s.replace(/\s+/g, ' ').trim();
}
