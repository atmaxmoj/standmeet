// agent-adapters.ts —— browser host adapters for @standmeet/agent-core.
// 三种 port 的浏览器实现：HTTP prompts、HTTP tool dispatcher、scripted
// mock LLM streamer (给 /dev/agent-spike 用，不依赖真 LLM 后端)。
//
// 实际生产 LLMStreamer (走 POST /inference/stream raw forwarder) 在
// 后端 inference 缩完之后单独 land；本文件只放 D-4 spike 用得到的。

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
