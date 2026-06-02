// pi-sse.ts —— parse the pi unified SSE stream emitted by backend's
// /api/v1/llm/chat/stream into agent-core LLMStreamEvent yield iterable.
//
// Frame shapes (matched by backend internal/inference/proxy_wire.go):
//
//   event: text
//   data: {"delta":"Hello"}
//
//   event: tool_call
//   data: {"id":"toolu_...","name":"corpus_search","input":{...}}
//
//   event: done
//   data: {"stop_reason":"end_turn|tool_use|max_tokens"}
//
//   event: error
//   data: {"code":"...","message":"..."}
//
// agent-core's LLMStreamEvent is provider-agnostic; this file is the
// translation layer between pi wire and the agent-core internal event.

import type { LLMStreamEvent } from '@standmeet/agent-core';

export async function* parsePiSSE(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLMStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const split = splitFrames(buf);
    buf = split.tail;
    for (const frame of split.frames) {
      const ev = dispatchFrame(frame);
      if (ev !== null) yield ev;
    }
  }
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
  let ev = '';
  let dt = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) ev = line.slice(7).trim();
    else if (line.startsWith('data: ')) dt = line.slice(6).trim();
  }
  return ev === '' ? null : { event: ev, data: dt };
}

function dispatchFrame(
  frame: { event: string; data: string },
): LLMStreamEvent | null {
  const d = safeJson(frame.data) as Record<string, unknown>;
  if (frame.event === 'error') {
    throw new Error(typeof d['message'] === 'string' ? d['message'] : 'llm error');
  }
  if (frame.event === 'text') {
    const delta = typeof d['delta'] === 'string' ? d['delta'] : '';
    if (delta === '') return null;
    return { type: 'text', delta };
  }
  if (frame.event === 'tool_call') {
    return parseToolCall(d);
  }
  if (frame.event === 'done') {
    return parseDone(d);
  }
  return null;
}

function parseToolCall(d: Record<string, unknown>): LLMStreamEvent {
  const id = typeof d['id'] === 'string' ? d['id'] : '';
  const name = typeof d['name'] === 'string' ? d['name'] : '';
  const args = d['input'] ?? {};
  return { type: 'tool_call', call: { id, name, args } };
}

function parseDone(d: Record<string, unknown>): LLMStreamEvent {
  const raw = typeof d['stop_reason'] === 'string' ? d['stop_reason'] : 'end_turn';
  return { type: 'done', stopReason: normalizeStopReason(raw) };
}

function normalizeStopReason(s: string): 'end_turn' | 'tool_use' | 'max_tokens' {
  if (s === 'tool_use' || s === 'end_turn' || s === 'max_tokens') return s;
  return 'end_turn';
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
