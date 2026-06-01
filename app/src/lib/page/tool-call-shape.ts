// tool-call-shape —— 把 tool result wire (unknown) narrow 成 UI 想要的形
// 状的纯数据 helper。ToolCallCards.tsx 是 presentation 层，不准做 if /
// 类型断言；narrow 在这一层完成。

import type { ToolCallView } from '@/lib/page/use-chat';

export interface SearchHit {
  path: string;
  title: string;
  genre: string;
  summary?: string;
}

// pickSearchHits —— corpus_search / corpus_list 的 result 是 row 数组
// ([{path, title, genre, summary?}])；从 unknown 抽出干净 SearchHit[]。
// 不识别的 row 丢弃 (path / title 缺一不可)。
export function pickSearchHits(raw: unknown): SearchHit[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchHit[] = [];
  for (const r of raw) {
    const hit = parseSearchHit(r);
    if (hit !== null) out.push(hit);
  }
  return out;
}

function parseSearchHit(raw: unknown): SearchHit | null {
  if (!isRecord(raw)) return null;
  const path = readStr(raw['path']);
  const title = readStr(raw['title']);
  const genre = readStr(raw['genre']);
  if (path === '' || title === '') return null;
  const summary = readStr(raw['summary']);
  return summary === ''
    ? { path, title, genre }
    : { path, title, genre, summary };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// shouldRenderCall —— UI dispatch 用：哪些 tool call 该渲卡片。
//   - ok=false → 不渲
//   - corpus_read → 已走 Citation，不重复
//   - calendar_book → G-7 接管
//   - 其他 → 渲
export function shouldRenderCall(c: ToolCallView): boolean {
  return c.ok && cardKindFor(c.name) !== 'none';
}

// CardKind —— UI 渲卡时按这个 dispatch 组件：
//   - 'search' → SearchHitsCard (corpus_search / corpus_list)
//   - 'dump'   → GenericDumpCard (skill_* / ext_* debug 框)
//   - 'none'   → 不渲
export type CardKind = 'search' | 'dump' | 'none';

export function cardKindFor(name: string): CardKind {
  if (name === 'corpus_search' || name === 'corpus_list') return 'search';
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
