// tool-call-shape —— 把 tool result wire (unknown) narrow 成 UI 想要的形
// 状的纯数据 helper。ToolCallCards.tsx 是 presentation 层，不准做 if /
// 类型断言；narrow 在这一层完成。

import type { ToolCallView } from '@/lib/page/use-chat';

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

// CardKind —— **legacy** 写死卡 dispatch（仅服务尚未外置的能力，随各能力外置逐个
// 删除，目标态为空）。外置后的能力自带 ui:// 卡走沙盒渲染，不在这。
//   - 'booked'  → BookCard (calendar_book 成功 confirmation) —— booked 卡的
//     cancel/确认信是 connector-backed mutation，归 connector 重构（最后一张写死卡）
//   - 'dump'    → GenericDumpCard (skill_* / ext_* debug 框)
//   - 'none'    → 不渲
// ask_visitor / retrieval / summarize / calendar_list_slots 已外置 → 自带 ui:// 卡。
export type CardKind = 'booked' | 'dump' | 'none';

export function cardKindFor(name: string): CardKind {
  if (name === 'calendar_book') return 'booked';
  if (name.startsWith('skill_') || name.startsWith('ext_')) return 'dump';
  return 'none';
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

// AskVisitorKind —— I.1 ask_visitor tool 的 widget 种类。yes_no 前端固
// 渲 Yes/No 两个按钮 (不读 options)；radio/multi 必读 options。
export type AskVisitorKind = 'radio' | 'multi' | 'yes_no';

// AskVisitorPayload —— ask_visitor tool_result 的 echo (backend 直接把
// LLM 的 args 原样推回；前端按 kind dispatch 渲对应 widget)。allowChat
// 默认 false。options 在 kind=yes_no 时忽略；为方便组件渲染统一为字符
// 串数组兜底空 []。
export interface AskVisitorPayload {
  question: string;
  kind: AskVisitorKind;
  options: readonly string[];
  allowChat: boolean;
}

// pickAskVisitor —— narrow ask_visitor result 到 AskVisitorPayload。
// 任一必填字段缺 / kind 非法 → null，UI 不渲。
export function pickAskVisitor(raw: unknown): AskVisitorPayload | null {
  if (!isRecordShape(raw)) return null;
  const question = readStrShape(raw['question']);
  const kind = readAskKind(raw['kind']);
  if (question === '' || kind === null) return null;
  return {
    question, kind,
    options: pickAskOptions(raw['options']),
    allowChat: raw['allow_chat'] === true,
  };
}

function readAskKind(v: unknown): AskVisitorKind | null {
  if (v === 'radio' || v === 'multi' || v === 'yes_no') return v;
  return null;
}

function pickAskOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const opt of v) {
    if (typeof opt === 'string' && opt !== '') out.push(opt);
  }
  return out;
}
