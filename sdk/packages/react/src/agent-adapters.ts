// agent-adapters.ts —— browser host adapters for @standmeet/agent-core.
// 4 种 port 的浏览器实现：HTTP prompts、HTTP tool dispatcher、scripted
// mock LLM streamer (给 /dev/agent-spike 用，不依赖真 LLM 后端)、
// HTTP inference streamer (走 POST /api/v1/inference/stream SSE
// 拿真 LLM single-turn 输出，给生产 visitor chat 用)。

import type {
  CapabilityState,
  LLMStreamRequest,
  LLMStreamEvent,
  LLMStreamer,
  PromptSource,
  ToolCall,
  ToolDispatcher,
  ToolResult,
} from '@standmeet/agent-core';

// ───── PromptSource: HTTP GET /api/v1/prompts/{id} ────────────────

export interface HttpPromptSourceOptions {
  readonly baseURL: string;
}

export function httpPromptSource(opts: HttpPromptSourceOptions): PromptSource {
  return {
    async load(id: string): Promise<string> {
      const res = await fetch(`${opts.baseURL}/api/v1/prompts/${id}`);
      if (!res.ok) {
        throw new Error(`prompts.load(${id}): ${res.status}`);
      }
      return await res.text();
    },
  };
}

// ───── ToolDispatcher: HTTP POST /sessions/{id}/tools/{name} ──────

export interface HttpToolDispatcherOptions {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly conversationID: string;
}

export function httpToolDispatcher(opts: HttpToolDispatcherOptions): ToolDispatcher {
  return {
    async call(call: ToolCall): Promise<ToolResult> {
      const res = await fetch(
        `${opts.baseURL}/api/v1/sessions/${opts.conversationID}/tools/${call.name}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(call.args),
        },
      );
      const body = await res.json() as ToolEnvelope;
      return {
        id: call.id,
        name: call.name,
        ok: body.ok,
        result: body.result,
        reason: body.reason,
        detail: body.detail,
        capability_state: body.capability_state,
      };
    },
  };
}

interface ToolEnvelope {
  ok: boolean;
  result?: unknown;
  reason?: string;
  detail?: string;
  capability_state?: readonly CapabilityState[];
}

// ───── LLMStreamer (scripted mock, D-4 spike only) ─────────────────
//
// scriptedLLMStreamer —— 拿一个预设的 (text, toolCalls) 序列；按 streamer
// 协议吐 events。让 /dev/agent-spike 不依赖真 LLM 后端。

export interface ScriptedStep {
  readonly text?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ScriptedLLMOptions {
  readonly steps: readonly ScriptedStep[];
}

export function scriptedLLMStreamer(opts: ScriptedLLMOptions): LLMStreamer {
  let cursor = 0;
  return {
    stream(req: LLMStreamRequest): AsyncIterable<LLMStreamEvent> {
      void req;
      const step = opts.steps[cursor] ?? { text: 'done.' };
      cursor++;
      return streamScriptedStep(step);
    },
  };
}

async function* streamScriptedStep(
  step: ScriptedStep,
): AsyncIterable<LLMStreamEvent> {
  if (step.text !== undefined) {
    for (const chunk of chunkText(step.text)) {
      yield { type: 'text', delta: chunk };
      await Promise.resolve();
    }
  }
  if (step.toolCalls && step.toolCalls.length > 0) {
    for (const call of step.toolCalls) {
      yield { type: 'tool_call', call };
    }
    yield { type: 'done', stopReason: 'tool_use' };
    return;
  }
  yield { type: 'done', stopReason: 'end_turn' };
}

function chunkText(text: string, size = 16): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

// ───── LLMStreamer (HTTP, prod): POST /api/v1/inference/stream ────

export interface HttpInferenceStreamerOptions {
  readonly baseURL: string;
  readonly sessionToken: string;
}

export function httpInferenceStreamer(
  opts: HttpInferenceStreamerOptions,
): LLMStreamer {
  return {
    stream(req: LLMStreamRequest): AsyncIterable<LLMStreamEvent> {
      return streamInferenceHTTP(opts, req);
    },
  };
}

interface InferenceStreamWireText { delta: string }
interface InferenceStreamWireToolCall {
  id: string;
  name: string;
  input: unknown;
}
interface InferenceStreamWireDone { stop_reason: string }
interface InferenceStreamWireError { message: string }

async function* streamInferenceHTTP(
  opts: HttpInferenceStreamerOptions,
  req: LLMStreamRequest,
): AsyncIterable<LLMStreamEvent> {
  const res = await fetch(`${opts.baseURL}/api/v1/inference/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system: req.system,
      messages: req.messages,
      tools: req.toolSpecs,
    }),
  });
  if (!res.ok || res.body === null) {
    throw new Error(`inference.stream: ${res.status}`);
  }
  yield* parseSSEEvents(res.body);
}

async function* parseSSEEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLMStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = splitSSEFrames(buf);
    buf = events.tail;
    for (const ev of events.frames) {
      const out = sseFrameToEvent(ev);
      if (out !== null) yield out;
    }
  }
}

interface SSESplitResult {
  frames: { type: string; data: string }[];
  tail: string;
}

function splitSSEFrames(buf: string): SSESplitResult {
  const out: { type: string; data: string }[] = [];
  const parts = buf.split('\n\n');
  for (let i = 0; i < parts.length - 1; i++) {
    const f = parseSSEFrame(parts[i] ?? '');
    if (f !== null) out.push(f);
  }
  return { frames: out, tail: parts.at(-1) ?? '' };
}

function parseSSEFrame(raw: string): { type: string; data: string } | null {
  let evType = '';
  let evData = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) evType = line.slice(7).trim();
    else if (line.startsWith('data: ')) evData = line.slice(6).trim();
  }
  return evType === '' ? null : { type: evType, data: evData };
}

function sseFrameToEvent(
  frame: { type: string; data: string },
): LLMStreamEvent | null {
  if (frame.type === 'text') {
    const d = JSON.parse(frame.data) as InferenceStreamWireText;
    return { type: 'text', delta: d.delta };
  }
  if (frame.type === 'tool_call') {
    const d = JSON.parse(frame.data) as InferenceStreamWireToolCall;
    return { type: 'tool_call', call: { id: d.id, name: d.name, args: d.input } };
  }
  if (frame.type === 'done') {
    const d = JSON.parse(frame.data) as InferenceStreamWireDone;
    return { type: 'done', stopReason: stopReasonFromWire(d.stop_reason) };
  }
  if (frame.type === 'error') {
    const d = JSON.parse(frame.data) as InferenceStreamWireError;
    throw new Error(d.message);
  }
  return null;
}

function stopReasonFromWire(
  raw: string,
): 'end_turn' | 'tool_use' | 'max_tokens' {
  if (raw === 'tool_use' || raw === 'end_turn' || raw === 'max_tokens') return raw;
  return 'end_turn';
}
