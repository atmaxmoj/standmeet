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
//   - ok=false → 不渲 (calendar_book 失败时 LLM 文字会解释)
//   - cardKindFor === 'none' → 不渲 (corpus_read 已走 Citation)
//   - 其他 → 渲
export function shouldRenderCall(c: ToolCallView): boolean {
  return c.ok && cardKindFor(c.name) !== 'none';
}

// BookConfirmation —— calendar_book 成功结果。
export interface BookConfirmation {
  eventID: string;
  htmlLink: string;
  start: string;
  end: string;
}

// pickBookConfirmation —— calendar_book result wire 是
// `{ok, event_id, html_link, start, end}` (BookCard 渲)。ok=false 时 caller
// 通过 shouldRenderCall 已经过滤掉。
export function pickBookConfirmation(raw: unknown): BookConfirmation | null {
  if (!isRecordShape(raw)) return null;
  const eventID = readStrShape(raw['event_id']);
  const htmlLink = readStrShape(raw['html_link']);
  const start = readStrShape(raw['start']);
  const end = readStrShape(raw['end']);
  return eventID === '' || start === '' ? null : { eventID, htmlLink, start, end };
}

// CardKind —— UI 渲卡时按这个 dispatch 组件：
//   - 'search'  → SearchHitsCard (corpus_search / corpus_list)
//   - 'slots'   → SlotsCard (calendar_list_slots，G-7)
//   - 'booked'  → BookCard (calendar_book 成功 confirmation，G-7)
//   - 'dump'    → GenericDumpCard (skill_* / ext_* debug 框)
//   - 'none'    → 不渲
export type CardKind = 'search' | 'slots' | 'booked' | 'dump' | 'none';

export function cardKindFor(name: string): CardKind {
  if (name === 'corpus_search' || name === 'corpus_list') return 'search';
  if (name === 'calendar_list_slots') return 'slots';
  if (name === 'calendar_book') return 'booked';
  if (name.startsWith('skill_') || name.startsWith('ext_')) return 'dump';
  return 'none';
}

// SlotView —— calendar_list_slots wire 的一条 slot ({start, end} RFC3339)。
export interface SlotView {
  start: string;
  end: string;
}

// pickSlots —— calendar_list_slots result 是 {ok, slots: [{start, end}]}；
// narrow 出 SlotView[]。失败 (wire 错 / ok=false) 返空。
export function pickSlots(raw: unknown): SlotView[] {
  if (!isRecordShape(raw)) return [];
  const slots = raw['slots'];
  if (!Array.isArray(slots)) return [];
  const out: SlotView[] = [];
  for (const s of slots) {
    const slot = parseSlot(s);
    if (slot !== null) out.push(slot);
  }
  return out;
}

function parseSlot(raw: unknown): SlotView | null {
  if (!isRecordShape(raw)) return null;
  const start = readStrShape(raw['start']);
  const end = readStrShape(raw['end']);
  return start === '' || end === '' ? null : { start, end };
}

function isRecordShape(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readStrShape(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
