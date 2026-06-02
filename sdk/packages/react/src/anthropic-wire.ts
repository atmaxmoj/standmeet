// anthropic-wire.ts —— translate between pi-agent-core's string-content
// Message wire and Anthropic's content-block wire on the way to / from
// /api/v1/inference/stream (which is a pure byte proxy of /v1/messages).
//
// pi-agent-core records this iteration's assistant output as a single
// Message with marker syntax:
//
//   "<text> [tool_use:NAME:ID] {args-json}"
//   "[tool_result:NAME:ID] {result-json}"  (role='user')
//
// We extract those markers into typed Anthropic content blocks. Plain
// text becomes a {type:'text'} block with no markers consumed.

import type { Message } from '@standmeet/agent-core';

import type { LLMStreamEvent } from '@standmeet/agent-core';

// ContentBlock —— union of the block types we ship to /v1/messages.
// Anthropic accepts more (image, document) but pi-agent-core never
// emits them; if needed, extend here.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMsg {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

// toAnthropicMessages —— convert pi Message[] into Anthropic shape.
// system messages are dropped (Anthropic carries system at top level).
export function toAnthropicMessages(
  msgs: readonly Message[],
): AnthropicMsg[] {
  const out: AnthropicMsg[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    out.push({ role: m.role, content: parseMessageContent(m.content) });
  }
  return out;
}

// parseMessageContent —— split content string into ordered blocks.
// Scans left to right for markers; non-marker text segments become
// text blocks.
function parseMessageContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const markerRe = /\[(tool_use|tool_result):([^:\]]+):([^\]]+)\]\s*/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = markerRe.exec(content)) !== null) {
    if (m.index > cursor) {
      const text = content.slice(cursor, m.index).trimEnd();
      if (text !== '') blocks.push({ type: 'text', text });
    }
    const kind = m[1]!;
    const name = m[2]!;
    const id = m[3]!;
    const after = m.index + m[0].length;
    const next = findNextMarker(content, after);
    const json = content.slice(after, next).trim();
    blocks.push(buildBlock(kind, name, id, json));
    cursor = next;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor).trim();
    if (tail !== '') blocks.push({ type: 'text', text: tail });
  }
  return blocks;
}

function findNextMarker(content: string, from: number): number {
  const idx = content.indexOf('[tool_', from);
  return idx === -1 ? content.length : idx;
}

function buildBlock(
  kind: string, name: string, id: string, json: string,
): ContentBlock {
  if (kind === 'tool_use') {
    let input: unknown = {};
    try { input = JSON.parse(json); } catch { input = {}; }
    return { type: 'tool_use', id, name, input };
  }
  // tool_result: Anthropic wants content as string (JSON of the result envelope)
  return { type: 'tool_result', tool_use_id: id, content: json };
}

// ───── parse Anthropic SSE → pi LLMStreamEvent stream ──────────────

interface BlockState {
  index: number;
  kind: 'text' | 'tool_use';
  id: string;
  name: string;
  inputBuf: string;
}

export async function* parseAnthropicSSE(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLMStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const state: { blocks: Map<number, BlockState>; stop: string } = {
    blocks: new Map(), stop: 'end_turn',
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const split = splitFrames(buf);
    buf = split.tail;
    for (const frame of split.frames) {
      yield* dispatchFrame(frame, state);
    }
  }
  yield* finalizeFrames(state);
}

function splitFrames(
  buf: string,
): { frames: { event: string; data: string }[]; tail: string } {
  const out: { event: string; data: string }[] = [];
  const parts = buf.split('\n\n');
  for (let i = 0; i < parts.length - 1; i++) {
    const f = parseFrame(parts[i] ?? '');
    if (f !== null) out.push(f);
  }
  return { frames: out, tail: parts.at(-1) ?? '' };
}

function parseFrame(raw: string): { event: string; data: string } | null {
  let ev = ''; let dt = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) ev = line.slice(7).trim();
    else if (line.startsWith('data: ')) dt = line.slice(6).trim();
  }
  return ev === '' ? null : { event: ev, data: dt };
}

function* dispatchFrame(
  frame: { event: string; data: string },
  state: { blocks: Map<number, BlockState>; stop: string },
): Generator<LLMStreamEvent, void, unknown> {
  if (frame.event === 'error') {
    const d = safeJson(frame.data) as { message?: string };
    throw new Error(d.message ?? 'inference error');
  }
  yield* applyAnthropicEvent(frame, state);
}

function* applyAnthropicEvent(
  frame: { event: string; data: string },
  state: { blocks: Map<number, BlockState>; stop: string },
): Generator<LLMStreamEvent, void, unknown> {
  const d = safeJson(frame.data) as AnthropicWireFrame;
  switch (frame.event) {
    case 'content_block_start':
      handleBlockStart(d, state.blocks);
      return;
    case 'content_block_delta':
      yield* handleBlockDelta(d, state.blocks);
      return;
    case 'message_delta':
      if (d.delta?.stop_reason) state.stop = d.delta.stop_reason;
      return;
    default:
      // message_start / content_block_stop / message_stop / ping —
      // no state change.
  }
}

function handleBlockStart(
  d: AnthropicWireFrame, blocks: Map<number, BlockState>,
): void {
  if (d.index === undefined || !d.content_block) return;
  blocks.set(d.index, {
    index: d.index,
    kind: d.content_block.type === 'tool_use' ? 'tool_use' : 'text',
    id: d.content_block.id ?? '',
    name: d.content_block.name ?? '',
    inputBuf: '',
  });
}

function* handleBlockDelta(
  d: AnthropicWireFrame, blocks: Map<number, BlockState>,
): Generator<LLMStreamEvent, void, unknown> {
  if (d.index === undefined || !d.delta) return;
  const b = blocks.get(d.index);
  if (!b) return;
  if (d.delta.type === 'text_delta' && d.delta.text) {
    yield { type: 'text', delta: d.delta.text };
    return;
  }
  if (d.delta.type === 'input_json_delta' && d.delta.partial_json) {
    b.inputBuf += d.delta.partial_json;
  }
}

function* finalizeFrames(
  state: { blocks: Map<number, BlockState>; stop: string },
): Generator<LLMStreamEvent, void, unknown> {
  const sorted = [...state.blocks.values()].sort((a, b) => a.index - b.index);
  for (const b of sorted) {
    if (b.kind === 'tool_use') {
      let args: unknown = {};
      if (b.inputBuf !== '') {
        try { args = JSON.parse(b.inputBuf); } catch { args = {}; }
      }
      yield {
        type: 'tool_call',
        call: { id: b.id, name: b.name, args },
      };
    }
  }
  yield { type: 'done', stopReason: stopReasonFromWire(state.stop) };
}

function stopReasonFromWire(raw: string): 'end_turn' | 'tool_use' | 'max_tokens' {
  if (raw === 'tool_use' || raw === 'end_turn' || raw === 'max_tokens') return raw;
  return 'end_turn';
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

interface AnthropicWireFrame {
  type?: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
}
