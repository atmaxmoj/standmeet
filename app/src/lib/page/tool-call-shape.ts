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
//
// 判据是**前缀**,不是一份名单。这里曾经写死 4 个名字,而后端注册的是 8 个
// (search/read/list/links/map/resolve/peek/grep) —— 后加的那 4 个既不进计数,
// cardKindFor 又返回 'none',两条分支都不渲,于是完全隐形:真实环境里 agent 一轮跑了
// 2 次 search + 3 次 grep + 1 次 read,访客看到的是 `searched 2 · read 1`(F-A-29)。
// 一份手抄的名单会在**每次**新增检索工具时重犯同一个错;前缀不会。
const RETRIEVAL_PREFIX = 'corpus_';

export function isRetrievalTool(name: string): boolean {
  return name.startsWith(RETRIEVAL_PREFIX);
}

// ENTRY_READ_TOOLS —— 打开某一条**具体条目**的内容的那些。peek 归这边:它拿的是那条笔记
// 自己的东西(标题/标签/小标题/出链/首行),只是不要全文 —— 对访客而言那是"看了这条",
// 不是"找了一圈"。其余(search/list/links/map/resolve/grep)都是在问"哪些条目相关"。
const ENTRY_READ_TOOLS = new Set(['corpus_read', 'corpus_peek']);

// RetrievalCounts —— 折叠后的检索计数。
export interface RetrievalCounts {
  searches: number;
  reads: number;
}

export function retrievalCounts(calls: readonly { name: string }[]): RetrievalCounts {
  let searches = 0;
  let reads = 0;
  for (const c of calls) {
    if (ENTRY_READ_TOOLS.has(c.name)) reads += 1;
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
