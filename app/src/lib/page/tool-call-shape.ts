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

// jsonPretty —— skill/ext result 的 debug-grade pretty print。failure
// 兜底为字符串化 (toString)。
export function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
