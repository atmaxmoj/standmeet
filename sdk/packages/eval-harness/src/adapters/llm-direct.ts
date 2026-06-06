// llm-direct.ts —— LLMStreamer adapter: 直打 provider 的 streaming endpoint。
// Scenario `model:` 字段决定走哪家；eval-harness 走 prod 同一 wire
// 但 host 自己签 API key (跟 prod backend 代理路径不重叠)。
//
// 当前支持 OpenAI Chat Completions 兼容协议 (DeepSeek + OpenAI)。
// Anthropic + Google 的 wire 跟 OpenAI 不一样，加 provider 时插 PROVIDERS 表，
// 各自实现 buildRequest + parseChunk 即可。
//
// 实现走 fetch + ReadableStream + SSE 行解析，不引 official SDK，
// 避免 deps 膨胀。Provider 抽象层故意小：3 个 hook (request / chunk / done)。

import type {
  LLMStreamEvent,
  LLMStreamRequest,
  LLMStreamer,
  LLMToolSpec,
  Message,
  ToolCall,
} from '@standmeet/agent-core';

import {
  pickProvider,
  type ProviderConfig,
} from './llm-providers.js';

export interface DirectLLMOptions {
  // model id, e.g. 'deepseek-chat' / 'gpt-4o' / 'claude-3-5-sonnet-20241022'。
  readonly model: string;
  // 可选 base URL 覆写 (eval mock / proxy 用)；空 = 走 provider 默认。
  readonly baseURL?: string;
  // 可选 api key 覆写；空 = 走 PROVIDERS env var (DEEPSEEK_API_KEY etc.)。
  readonly apiKey?: string;
  // 可选 fetch 注入 (test 隔离用)；默认走全局 fetch。
  readonly fetch?: typeof fetch;
}

export class DirectLLMConfigError extends Error {
  override name = 'DirectLLMConfigError';
}

export function directLLMStreamer(opts: DirectLLMOptions): LLMStreamer {
  const provider = pickProvider(opts.model);
  const apiKey = opts.apiKey ?? readEnvKey(provider);
  if (!apiKey) {
    throw new DirectLLMConfigError(
      `directLLMStreamer: ${provider.name} 模型 "${opts.model}" 缺少 API key (env ${provider.envKey})`,
    );
  }
  const baseURL = opts.baseURL ?? provider.defaultBaseURL;
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    stream(req: LLMStreamRequest): AsyncIterable<LLMStreamEvent> {
      return streamOnce({ req, provider, model: opts.model, baseURL, apiKey, doFetch });
    },
  };
}

function readEnvKey(provider: ProviderConfig): string | undefined {
  const v = process.env[provider.envKey];
  return v && v.trim() !== '' ? v : undefined;
}

// ──────────────────────────────────────────────────────────────
// streamOnce —— 一次 LLM 调用：build → POST → SSE parse → translate。
// ──────────────────────────────────────────────────────────────

interface StreamCtx {
  readonly req: LLMStreamRequest;
  readonly provider: ProviderConfig;
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly doFetch: typeof fetch;
}

async function* streamOnce(ctx: StreamCtx): AsyncIterable<LLMStreamEvent> {
  const nameMap = buildToolNameMap(ctx.req.toolSpecs);
  const body = buildOpenAIBody(ctx.req, ctx.model, nameMap);
  const url = ctx.baseURL.replace(/\/$/, '') + '/v1/chat/completions';
  const res = await ctx.doFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || res.body === null) {
    const text = await safeText(res);
    throw new Error(`directLLMStreamer: ${ctx.provider.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const accumulator = new ToolCallAccumulator(nameMap);
  for await (const event of parseOpenAISSE(reader)) {
    yield* translateOpenAIChunk(event, accumulator);
  }
}

// ToolNameMap —— OpenAI 严限 tool name 到 [a-zA-Z0-9_-]+；prod 用 dot
// 分段命名 (corpus.search / calendar.book)，发到 wire 时 `.` → `__`，
// 收回来反向 decode。下划线本身不冲突 (模型生成自己未见过的 `__` 概率
// 极低)；冲突时让 dispatcher 兜底返 unknown-tool 错。
interface ToolNameMap {
  // 原名 → wire 名
  readonly toWire: Readonly<Record<string, string>>;
  // wire 名 → 原名 (反查)
  readonly fromWire: Readonly<Record<string, string>>;
}

function buildToolNameMap(specs: readonly LLMToolSpec[]): ToolNameMap {
  const toWire: Record<string, string> = {};
  const fromWire: Record<string, string> = {};
  for (const s of specs) {
    const wire = sanitizeToolName(s.name);
    toWire[s.name] = wire;
    fromWire[wire] = s.name;
  }
  return { toWire, fromWire };
}

function sanitizeToolName(name: string): string {
  // dot → 双下划线；其它非法字符 → 单下划线。reversible 只对 dot 保证。
  return name.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ──────────────────────────────────────────────────────────────
// OpenAI / DeepSeek request body shape。
// ──────────────────────────────────────────────────────────────

interface OpenAIBody {
  readonly model: string;
  readonly stream: true;
  readonly messages: readonly OpenAIMessage[];
  readonly tools?: readonly OpenAITool[];
  readonly tool_choice?: 'auto';
}

interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_calls?: readonly OpenAIToolCallRef[];
  readonly tool_call_id?: string;
}

interface OpenAIToolCallRef {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAITool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
}

function buildOpenAIBody(
  req: LLMStreamRequest, model: string, nameMap: ToolNameMap,
): OpenAIBody {
  const messages: OpenAIMessage[] = [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => messageToOpenAI(m, nameMap)),
  ];
  const body: OpenAIBody = {
    model, stream: true, messages,
    ...(req.toolSpecs.length > 0
      ? {
          tools: req.toolSpecs.map((s) => toolSpecToOpenAI(s, nameMap)),
          tool_choice: 'auto' as const,
        }
      : {}),
  };
  return body;
}

function messageToOpenAI(m: Message, nameMap: ToolNameMap): OpenAIMessage {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id ?? '' };
  }
  if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
    return {
      role: 'assistant', content: m.content,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id, type: 'function' as const,
        function: {
          name: nameMap.toWire[tc.name] ?? sanitizeToolName(tc.name),
          arguments: JSON.stringify(tc.args),
        },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function toolSpecToOpenAI(s: LLMToolSpec, nameMap: ToolNameMap): OpenAITool {
  return {
    type: 'function',
    function: {
      name: nameMap.toWire[s.name] ?? sanitizeToolName(s.name),
      description: s.description, parameters: s.input_schema,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// SSE 行解析 —— OpenAI 形态: `data: <JSON>\n\n` + `data: [DONE]\n\n`。
// ──────────────────────────────────────────────────────────────

interface OpenAIStreamChunk {
  readonly choices?: readonly OpenAIStreamChoice[];
}

interface OpenAIStreamChoice {
  readonly delta?: OpenAIStreamDelta;
  readonly finish_reason?: string | null;
}

interface OpenAIStreamDelta {
  readonly content?: string;
  readonly tool_calls?: readonly OpenAIToolCallDelta[];
}

interface OpenAIToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

async function* parseOpenAISSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<OpenAIStreamChunk | 'done'> {
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const ev = parseSSELine(line);
      if (ev !== null) yield ev;
      nl = buf.indexOf('\n');
    }
  }
}

function parseSSELine(line: string): OpenAIStreamChunk | 'done' | null {
  if (line === '' || !line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return 'done';
  try {
    return JSON.parse(payload) as OpenAIStreamChunk;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Chunk → LLMStreamEvent translation。
// 关键：tool_calls 是流式的，arguments 一段段拼，结束 (finish_reason
// 或 [DONE]) 时整体 yield 一次 tool_call 事件。
// ──────────────────────────────────────────────────────────────

class ToolCallAccumulator {
  private readonly slots: PendingToolCall[] = [];
  private readonly nameMap: ToolNameMap;

  constructor(nameMap: ToolNameMap) { this.nameMap = nameMap; }

  ingest(delta: OpenAIToolCallDelta): void {
    const slot = this.ensureSlot(delta.index);
    if (delta.id !== undefined) slot.id = delta.id;
    if (delta.function?.name !== undefined) slot.name = delta.function.name;
    if (delta.function?.arguments !== undefined) slot.args += delta.function.arguments;
  }

  flush(): ToolCall[] {
    const out: ToolCall[] = [];
    for (const slot of this.slots) {
      out.push({
        id: slot.id,
        name: this.nameMap.fromWire[slot.name] ?? slot.name,
        args: parseArgsSafely(slot.args),
      });
    }
    this.slots.length = 0;
    return out;
  }

  hasPending(): boolean { return this.slots.length > 0; }

  private ensureSlot(index: number): PendingToolCall {
    while (this.slots.length <= index) {
      this.slots.push({ id: '', name: '', args: '' });
    }
    return this.slots[index];
  }
}

interface PendingToolCall { id: string; name: string; args: string; }

function parseArgsSafely(raw: string): unknown {
  if (raw === '') return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

function* translateOpenAIChunk(
  ev: OpenAIStreamChunk | 'done',
  acc: ToolCallAccumulator,
): Generator<LLMStreamEvent> {
  if (ev === 'done') {
    yield* flushDone(acc, 'end_turn');
    return;
  }
  const choice = ev.choices?.[0];
  if (!choice) return;
  if (choice.delta?.content) {
    yield { type: 'text', delta: choice.delta.content };
  }
  if (choice.delta?.tool_calls) {
    for (const d of choice.delta.tool_calls) acc.ingest(d);
  }
  if (choice.finish_reason) {
    yield* flushDone(acc, mapFinishReason(choice.finish_reason));
  }
}

function* flushDone(
  acc: ToolCallAccumulator, stopReason: 'end_turn' | 'tool_use' | 'max_tokens',
): Generator<LLMStreamEvent> {
  if (acc.hasPending()) {
    for (const call of acc.flush()) {
      yield { type: 'tool_call', call };
    }
    yield { type: 'done', stopReason: 'tool_use' };
    return;
  }
  yield { type: 'done', stopReason };
}

function mapFinishReason(reason: string): 'end_turn' | 'tool_use' | 'max_tokens' {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return '<unreadable response body>'; }
}
