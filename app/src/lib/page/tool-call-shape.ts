// tool-call-shape —— 把 tool result wire (unknown) narrow 成 UI 想要的形
// 状的纯数据 helper。ToolCallCards.tsx 是 presentation 层，不准做 if /
// 类型断言；narrow 在这一层完成。

// CardKind —— **legacy** 写死卡 dispatch（仅服务尚未外置的能力；外置后的能力自带
// ui:// 卡走沙盒渲染，不在这）。booked(calendar_book) 已外置成 booker 插件的 ui:// 卡，
// 这里只剩 skill_*/ext_* 的通用 debug 兜底。
//   - 'dump' → GenericDumpCard (skill_* / ext_* debug 框)
//   - 'none' → 不渲
export type CardKind = 'dump' | 'none';

export function cardKindFor(name: string): CardKind {
  if (name.startsWith('skill_') || name.startsWith('ext_')) return 'dump';
  return 'none';
}

// isRetrievalTool —— corpus_* 检索族。这些工具**不**各渲一张 ui:// 沙盒卡:一个真模型
// 一轮可能检索十几次,per-call 卡片会竖着堆满屏(UX-10)。它们折叠成一行 RetrievalSummary;
// 「读了哪些」由 citations footer 承载(原设计:corpus_read 本就不重复渲卡)。
const RETRIEVAL_TOOLS = new Set([
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
]);

export function isRetrievalTool(name: string): boolean {
  return RETRIEVAL_TOOLS.has(name);
}

// RetrievalCounts —— 折叠后的检索计数(searched = search/list/links;read = corpus_read)。
export interface RetrievalCounts {
  searches: number;
  reads: number;
}

export function retrievalCounts(calls: readonly { name: string }[]): RetrievalCounts {
  let searches = 0;
  let reads = 0;
  for (const c of calls) {
    if (c.name === 'corpus_read') reads += 1;
    else searches += 1;
  }
  return { searches, reads };
}

// jsonPretty —— skill/ext result 的 debug-grade pretty print。failure
// 兜底为字符串化 (toString)。
export function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
