// agent-turn.ts —— H.10: VisitorTurnAgent，agent-core 唯一的 agent 入口。
//
// H.9 backend (eino ADK) 接管 LLM ↔ tool loop 之后，浏览器只是 event
// consumer —— 单一 POST /api/v1/agent/turn，SSE 收整套事件 (text /
// tool_started / tool_completed / done / error)，分派给 observer 渲 UI 即可。
// (老的浏览器侧 VisitorAgent loop 已删，只剩 3 ports: prompts / turn / observer)

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
  // conversationID 持久化 chat 行的 UUID，每次 /agent/turn 都要带，让
  // backend tool (calendar_book / 等) 找得到归属的 conversation。
  readonly conversationID: string;
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
      system, userMessage: opts.userMessage,
      conversationID: this.cfg.conversationID, history,
    };
    this.emit({ type: 'iteration_started', iter: 0 });
    const ctx = makeCtx();
    try {
      for await (const ev of this.ports.turn.stream(req)) {
        this.consumeEvent(ev, ctx);
      }
    } catch (err) {
      // 流被中途掐断:reader.read() reject(代理/服务器 write-deadline 超时、
      // 网络抖动 → ERR_INCOMPLETE_CHUNKED_ENCODING),或 streamer 在拿到响应
      // 时就因非 2xx 抛错(401 session 失效 / 403 等)。绝不让对话卡 pending。
      ctx.streamCut = true;
      ctx.cutStatus = readCutStatus(err);
    }
    this.emit({ type: 'iteration_completed', iter: 0 });
    // 流被掐断但已经收到可用回答(常见:答案流完了、被掐的只是 done 尾帧)→
    // 当截断答案正常收尾。一个字都没收到才 surface 友好 error;按 status 区分
    // 「session 失效要重进」和「连接掉线再试一次」。
    if (ctx.streamCut && ctx.text === '') {
      ctx.errored = true;
      this.emit({ type: 'error', message: cutMessage(ctx.cutStatus) });
    }
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
        this.emit({
          type: 'tool_started', name: ev.name, args: ev.args,
          progressLabel: ev.progressLabel,
        });
        return;
      case 'tool_completed':
        this.emitToolCompleted(ev);
        return;
      case 'ghosts':
        this.emit({ type: 'ghosts_received', items: ev.items });
        return;
      case 'retrying':
        this.emit({ type: 'retrying', attempt: ev.attempt });
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

// STREAM_CUT_MESSAGE —— 流被掐断且一个字都没收到时给 visitor 的人话兜底。
// 不暴露 ERR_INCOMPLETE_CHUNKED_ENCODING 之类的技术细节。
const STREAM_CUT_MESSAGE =
  'The connection dropped before a reply came back. Please try asking again.';

// SESSION_EXPIRED_MESSAGE —— 401/403:session token 失效(过期 / 实例重置 /
// 配额耗尽)。再试一次没用,得用访问链接重进 —— 说清楚,别让人对着 "try again"。
const SESSION_EXPIRED_MESSAGE =
  'Your session is no longer valid (it may have expired). Re-open your access link to continue.';

// cutMessage —— 按掐断时的 HTTP status 选文案:401/403 → 重进;其它 → 重试。
function cutMessage(status: number): string {
  return status === 401 || status === 403 ? SESSION_EXPIRED_MESSAGE : STREAM_CUT_MESSAGE;
}

// readCutStatus —— 从 streamer 抛的 error 上取 HTTP status(agent-adapters 用
// Object.assign 挂的);取不到返 0。
function readCutStatus(err: unknown): number {
  if (err === null || typeof err !== 'object') return 0;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : 0;
}

interface TurnCtx {
  text: string;
  errored: boolean;
  // streamCut —— 流在 done 帧之前被掐断(reader 抛错)。
  streamCut: boolean;
  // cutStatus —— 掐断时若是非 2xx 响应,带上 HTTP status(401/403 等);否则 0。
  cutStatus: number;
}

function makeCtx(): TurnCtx {
  return { text: '', errored: false, streamCut: false, cutStatus: 0 };
}

// safeParseToolResult —— H.10: backend agent loop 把 tool RunFn 的 raw
// 返回字符串原样塞进 SSE tool_completed.result。各 tool wire 形态
// heterogeneous：
//   - corpus_search/list: bare array  `[{path, title, genre, summary}]`
//   - corpus_read: flat object        `{genre, body, path, title}`
//   - calendar_list_slots: envelope   `{ok, slots: [...]}`
//   - calendar_book ok: envelope      `{ok, event_id, html_link, start, end}`
//   - calendar_book fail: envelope    `{ok: false, conflict, ...}`
//   - skill_* / ext_*: 任意 JSON
//
// 这一层只做：
//   - JSON.parse
//   - 顶层有 `ok: boolean` 时把它当 result 的 ok 透上去 (shouldRenderCall
//     按 c.ok 过滤失败 card)；result 字段仍透整 parsed 对象 (consumer
//     的 pickSlots / pickBookConfirmation 自己 narrow)
//
// 不准对 `{ok, ...}` 当 {ok, result, reason} envelope 解包成 result =
// parsed.result —— 那会把 {ok, slots} 误解成 {ok, result: undefined}
// 丢数据 (H.10 sweep SlotsCard 显 0 slot 的 regression 踩这条)。
function safeParseToolResult(raw: string): {
  ok: boolean; result?: unknown; reason?: string;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isOkEnvelope(parsed)) {
      return { ok: parsed.ok, result: parsed, reason: parsed.reason };
    }
    return { ok: true, result: parsed };
  } catch {
    return { ok: true, result: raw };
  }
}

function isOkEnvelope(
  v: unknown,
): v is { ok: boolean; reason?: string } {
  return (
    v !== null && typeof v === 'object' && !Array.isArray(v)
    && 'ok' in v && typeof (v as Record<string, unknown>)['ok'] === 'boolean'
  );
}
