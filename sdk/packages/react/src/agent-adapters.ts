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

import { parseAnthropicSSE, toAnthropicMessages } from './anthropic-wire';

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
  // 可选 BYOAI 信封 headers (跟 /messages 老路径同 wire)。byoai mode 下
  // visitor browser 持 plaintext key + HKDF(session_token) 派 AES key
  // 信封，X-Byoai-* headers 带过来；server 解封即用即丢。
  readonly byoai?: HttpBYOAIHeaders;
}

export interface HttpBYOAIHeaders {
  readonly provider: string;
  readonly wrappedKey: string; // base64 url-safe no-pad envelope
  readonly endpoint: string;
  readonly model: string;
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

async function* streamInferenceHTTP(
  opts: HttpInferenceStreamerOptions,
  req: LLMStreamRequest,
): AsyncIterable<LLMStreamEvent> {
  const res = await fetch(`${opts.baseURL}/api/v1/inference/stream`, {
    method: 'POST',
    headers: inferenceHeaders(opts),
    body: JSON.stringify({
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: req.toolSpecs,
    }),
  });
  if (!res.ok || res.body === null) {
    throw new Error(`inference.stream: ${res.status}`);
  }
  yield* parseAnthropicSSE(res.body);
}

function inferenceHeaders(opts: HttpInferenceStreamerOptions): HeadersInit {
  const base: Record<string, string> = {
    Authorization: `Bearer ${opts.sessionToken}`,
    'Content-Type': 'application/json',
  };
  return opts.byoai ? { ...base, ...byoaiToHeaders(opts.byoai) } : base;
}

function byoaiToHeaders(b: HttpBYOAIHeaders): Record<string, string> {
  return {
    'X-Byoai-Provider': b.provider,
    'X-Byoai-Key': b.wrappedKey,
    'X-Byoai-Endpoint': b.endpoint,
    'X-Byoai-Model': b.model,
  };
}

// Anthropic SSE parsing + pi-Message ↔ Anthropic content translation
// live in anthropic-wire.ts (imported above).
