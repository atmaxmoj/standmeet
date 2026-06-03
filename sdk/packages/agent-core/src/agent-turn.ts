// agent-turn.ts —— H.10: VisitorTurnAgent，agent-core 的 "降级版"。
//
// 老 VisitorAgent 在浏览器里跑 LLM ↔ tool 循环 (5 个 port: prompts /
// capabilities / llm / tools / observer)；H.9 backend 接管 loop 之后
// 浏览器只是 event consumer —— 单一 POST /api/v1/agent/turn，SSE 收
// 整套事件 (text / tool_started / tool_completed / done / error)，分
// 派给 observer 渲 UI 即可。
//
// 老 VisitorAgent 在 H.12 sweep 时删；当下并存让 caller 平滑切。

import type {
  EventObserver,
  PromptSource,
  TurnRequest,
  TurnStreamer,
} from './ports.js';
import type { AgentEvent, AgentTurnEvent, Message } from './types.js';

export interface VisitorTurnAgentPorts {
  readonly prompts: PromptSource;
  readonly turn: TurnStreamer;
  readonly observer?: EventObserver;
}

export interface VisitorTurnAgentConfig {
  readonly systemPromptPartIDs: readonly string[];
}

export interface SendTurnOptions {
  readonly userMessage: string;
  readonly history?: readonly Message[];
}

export class VisitorTurnAgent {
  private readonly ports: VisitorTurnAgentPorts;
  private readonly cfg: VisitorTurnAgentConfig;

  constructor(ports: VisitorTurnAgentPorts, cfg: VisitorTurnAgentConfig) {
    this.ports = ports;
    this.cfg = cfg;
  }

  // send —— 一整 turn：拼 system prompt → POST /agent/turn → 收 SSE 事件
  // → emit observer events → 返回更新后的 message history (caller 持给下
  // 次调用)。
  async send(opts: SendTurnOptions): Promise<readonly Message[]> {
    const system = await this.composeSystemPrompt();
    const history = opts.history ?? [];
    const req: TurnRequest = {
      system, userMessage: opts.userMessage, history,
    };
    this.emit({ type: 'iteration_started', iter: 0 });
    const ctx = makeCtx();
    for await (const ev of this.ports.turn.stream(req)) {
      this.consumeEvent(ev, ctx);
    }
    this.emit({ type: 'iteration_completed', iter: 0 });
    if (ctx.errored) return history;
    this.emit({ type: 'final_text', text: ctx.text });
    return [
      ...history,
      { role: 'user', content: opts.userMessage },
      { role: 'assistant', content: ctx.text },
    ];
  }

  private consumeEvent(ev: AgentTurnEvent, ctx: TurnCtx): void {
    switch (ev.type) {
      case 'text':
        ctx.text += ev.delta;
        this.emit({ type: 'llm_chunk', text: ev.delta });
        return;
      case 'tool_started':
        this.emit({ type: 'tool_started', name: ev.name });
        return;
      case 'tool_completed':
        this.emitToolCompleted(ev);
        return;
      case 'done':
        return;
      case 'error':
        ctx.errored = true;
        this.emit({ type: 'error', message: ev.message });
    }
  }

  private emitToolCompleted(
    ev: { name: string; result: string } & { type: 'tool_completed' },
  ): void {
    const parsed = safeParseToolResult(ev.result);
    this.emit({
      type: 'tool_completed',
      result: {
        id: '', name: ev.name,
        ok: parsed.ok, result: parsed.result, reason: parsed.reason,
      },
    });
  }

  private async composeSystemPrompt(): Promise<string> {
    const parts: string[] = [];
    for (const id of this.cfg.systemPromptPartIDs) {
      parts.push(await this.ports.prompts.load(id));
    }
    return parts.join('\n\n');
  }

  private emit(event: AgentEvent): void {
    this.ports.observer?.onEvent(event);
  }
}

interface TurnCtx {
  text: string;
  errored: boolean;
}

function makeCtx(): TurnCtx {
  return { text: '', errored: false };
}

// safeParseToolResult —— backend tool dispatcher 现在直接 raw JSON 进
// tool_completed.result；老 ToolDispatcher 走 envelope {ok, result,
// reason}。这里两种都尝试解，让 UI 渲染层不受 wire 差异影响。
function safeParseToolResult(raw: string): {
  ok: boolean; result?: unknown; reason?: string;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isResultEnvelope(parsed)) {
      return { ok: parsed.ok, result: parsed.result, reason: parsed.reason };
    }
    return { ok: true, result: parsed };
  } catch {
    return { ok: true, result: raw };
  }
}

function isResultEnvelope(
  v: unknown,
): v is { ok: boolean; result?: unknown; reason?: string } {
  return v !== null && typeof v === 'object' && 'ok' in v;
}
