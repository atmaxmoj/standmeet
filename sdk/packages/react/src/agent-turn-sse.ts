// agent-turn-sse.ts —— parse backend /api/v1/agent/turn SSE 流为
// agent-core AgentTurnEvent。
//
// Frame shapes (backend internal/inference/agent_turn.go):
//
//   event: text           data: {"delta":"..."}
//   event: tool_started   data: {"id","name","args","progress_label"}
//   event: tool_completed data: {"name","result"}
//   event: ghost          data: {"text","target_waypoint","follows_from","ghost_id","is_bridge"}
//   event: done           data: {"stop_reason":"end_turn|tool_use|max_tokens"}
//   event: error          data: {"code","message"}

import type { AgentTurnEvent } from '@standmeet/agent-core';

export async function* parseAgentTurnSSE(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<AgentTurnEvent> {
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
): AgentTurnEvent | null {
  const d = safeJson(frame.data) as Record<string, unknown>;
  switch (frame.event) {
    case 'text': return parseText(d);
    case 'tool_started': return parseToolStarted(d);
    case 'tool_completed': return parseToolCompleted(d);
    case 'ghost': return parseGhost(d);
    case 'retrying': return parseRetrying(d);
    case 'done': return parseDone(d);
    case 'error': return parseError(d);
  }
  return null;
}

function parseRetrying(d: Record<string, unknown>): AgentTurnEvent {
  const n = d['attempt'];
  return { type: 'retrying', attempt: typeof n === 'number' ? n : 1 };
}

function parseText(d: Record<string, unknown>): AgentTurnEvent | null {
  const delta = typeof d['delta'] === 'string' ? d['delta'] : '';
  return delta === '' ? null : { type: 'text', delta };
}

function parseToolStarted(d: Record<string, unknown>): AgentTurnEvent {
  return {
    type: 'tool_started',
    id: stringOr(d['id'], ''),
    name: stringOr(d['name'], ''),
    args: d['args'] ?? {},
    progressLabel: stringOrUndef(d['progress_label']),
  };
}

function parseToolCompleted(d: Record<string, unknown>): AgentTurnEvent {
  return {
    type: 'tool_completed',
    name: stringOr(d['name'], ''),
    result: stringOr(d['result'], ''),
  };
}

// parseGhost —— Ghost P4: 单条 policy steering ghost 帧（后端 GhostFrame）。text 空 → 丢帧。
function parseGhost(d: Record<string, unknown>): AgentTurnEvent | null {
  const text = stringOr(d['text'], '');
  if (text === '') return null;
  return {
    type: 'ghost',
    text,
    target_waypoint: stringOrUndef(d['target_waypoint']),
    follows_from: stringOrUndef(d['follows_from']),
    ghost_id: stringOrUndef(d['ghost_id']),
    is_bridge: typeof d['is_bridge'] === 'boolean' ? d['is_bridge'] : undefined,
  };
}

function parseDone(d: Record<string, unknown>): AgentTurnEvent {
  const raw = stringOr(d['stop_reason'], 'end_turn');
  return { type: 'done', stopReason: normStop(raw) };
}

function parseError(d: Record<string, unknown>): AgentTurnEvent {
  return {
    type: 'error',
    code: stringOr(d['code'], 'agent_error'),
    message: stringOr(d['message'], 'agent error'),
  };
}

function normStop(s: string): 'end_turn' | 'tool_use' | 'max_tokens' {
  if (s === 'tool_use' || s === 'end_turn' || s === 'max_tokens') return s;
  return 'end_turn';
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
