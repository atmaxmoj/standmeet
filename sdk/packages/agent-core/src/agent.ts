// agent.ts —— VisitorAgent: 持 5 个 port，跑 LLM ↔ tool 循环到 stop。
//
// 每轮：
//   1. 按当前 capability state 算 toolSpecs (cap.enabled + 加描述)
//   2. observer iteration_started → llmStream → 收 text 和 tool_call
//   3. 有 tool_call → dispatcher.call() → tool_result 进 observer +
//      message 历史；继续下一轮
//   4. 无 tool_call → final_text → done
//
// 不变量：
//   - agent-core 只对 ports 编程，不知道 HTTP / fs 是啥
//   - LLM 看到的 toolSpecs 必须跟 capabilityState 一致 (caller 不能
//     自己塞 spec)；这是 "拒了返新 state → 重装配" 闭环的前端兜底

import type {
  CapabilityStateSource,
  EventObserver,
  LLMStreamRequest,
  LLMStreamer,
  LLMToolSpec,
  PromptSource,
  ToolDispatcher,
} from './ports.js';
import type {
  AgentEvent,
  CapabilityState,
  Message,
  ToolCall,
  ToolResult,
} from './types.js';

export interface VisitorAgentPorts {
  readonly prompts: PromptSource;
  readonly capabilities: CapabilityStateSource;
  readonly llm: LLMStreamer;
  readonly tools: ToolDispatcher;
  readonly observer?: EventObserver;
}

export interface VisitorAgentConfig {
  readonly systemPromptPartIDs: readonly string[];
  readonly toolSpecRegistry: ToolSpecRegistry;
  readonly maxIterations?: number;
}

// ToolSpecRegistry —— capability id → JSON schema + description.
// agent-core 不知道 backend 的具体 tool spec 形态，让 caller (host
// adapter) 一次注入；每 iter 用它给 enabled cap 算 LLM toolSpecs。
export interface ToolSpecRegistry {
  forCapability(capabilityID: string): readonly LLMToolSpec[];
}

export interface SendOptions {
  readonly userMessage: string;
  readonly history?: readonly Message[];
}

export class VisitorAgent {
  private readonly ports: VisitorAgentPorts;
  private readonly cfg: VisitorAgentConfig;
  private readonly maxIter: number;

  constructor(ports: VisitorAgentPorts, cfg: VisitorAgentConfig) {
    this.ports = ports;
    this.cfg = cfg;
    this.maxIter = cfg.maxIterations ?? 8;
  }

  // send —— run one turn (user msg → LLM ↔ tool until stop) and return
  // the full updated message history. Stream of events is delivered via
  // EventObserver, not return value, so callers (React hook, eval
  // printer) don't have to async-iterate.
  async send(opts: SendOptions): Promise<readonly Message[]> {
    const system = await this.composeSystemPrompt();
    let messages: readonly Message[] = [
      ...(opts.history ?? []),
      { role: 'user', content: opts.userMessage },
    ];
    for (let iter = 0; iter < this.maxIter; iter++) {
      this.emit({ type: 'iteration_started', iter });
      const stepResult = await this.step(system, messages);
      messages = stepResult.messages;
      this.emit({ type: 'iteration_completed', iter });
      if (stepResult.kind === 'done') {
        this.emit({ type: 'final_text', text: stepResult.finalText });
        return messages;
      }
    }
    this.emit({ type: 'error', message: `max iterations (${this.maxIter}) reached` });
    return messages;
  }

  private async step(
    system: string, messages: readonly Message[],
  ): Promise<StepResult> {
    const toolSpecs = this.toolSpecsForCurrentCaps();
    const req: LLMStreamRequest = { system, messages, toolSpecs };
    const stepCtx: StepCtx = { text: '', toolCalls: [] };
    for await (const ev of this.ports.llm.stream(req)) {
      this.consumeLLMEvent(ev, stepCtx);
    }
    if (stepCtx.toolCalls.length === 0) {
      return { kind: 'done', finalText: stepCtx.text, messages: [
        ...messages, { role: 'assistant', content: stepCtx.text },
      ]};
    }
    return this.runTools(messages, stepCtx);
  }

  private consumeLLMEvent(ev: LLMStreamEventLocal, ctx: StepCtx): void {
    switch (ev.type) {
      case 'text':
        ctx.text += ev.delta;
        this.emit({ type: 'llm_chunk', text: ev.delta });
        return;
      case 'tool_call':
        ctx.toolCalls.push(ev.call);
        this.emit({ type: 'llm_tool_request', call: ev.call });
        return;
      case 'done':
        return;
    }
  }

  private async runTools(
    messages: readonly Message[], ctx: StepCtx,
  ): Promise<StepResult> {
    let history = [...messages];
    if (ctx.text !== '') {
      history.push({ role: 'assistant', content: ctx.text });
    }
    for (const call of ctx.toolCalls) {
      const result = await this.dispatchOne(call);
      history = [...history, toolResultAsMessage(result)];
    }
    return { kind: 'continue', messages: history };
  }

  private async dispatchOne(call: ToolCall): Promise<ToolResult> {
    this.emit({ type: 'tool_started', name: call.name });
    const result = await this.ports.tools.call(call);
    this.emit({ type: 'tool_completed', result });
    if (result.capability_state) {
      this.emit({
        type: 'capability_state_changed', states: result.capability_state,
      });
    }
    return result;
  }

  private async composeSystemPrompt(): Promise<string> {
    const parts: string[] = [];
    for (const id of this.cfg.systemPromptPartIDs) {
      parts.push(await this.ports.prompts.load(id));
    }
    return parts.join('\n\n');
  }

  private toolSpecsForCurrentCaps(): readonly LLMToolSpec[] {
    const out: LLMToolSpec[] = [];
    for (const cap of this.ports.capabilities.current()) {
      if (!cap.enabled) continue;
      for (const spec of this.cfg.toolSpecRegistry.forCapability(cap.id)) {
        out.push(spec);
      }
    }
    return out;
  }

  private emit(event: AgentEvent): void {
    this.ports.observer?.onEvent(event);
  }
}

// Local alias to keep import surface small (re-imported by hook layer).
type LLMStreamEventLocal =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | { readonly type: 'done'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' };

interface StepCtx {
  text: string;
  toolCalls: ToolCall[];
}

type StepResult =
  | { readonly kind: 'done'; readonly finalText: string; readonly messages: readonly Message[] }
  | { readonly kind: 'continue'; readonly messages: readonly Message[] };

function toolResultAsMessage(result: ToolResult): Message {
  return {
    role: 'assistant',
    content: `[tool_result:${result.name}] ` + JSON.stringify({
      ok: result.ok, result: result.result, reason: result.reason,
    }),
  };
}

// re-export the cap type so consumers can build CapabilityStateSource
// implementations without importing types.ts separately.
export type { CapabilityState };
