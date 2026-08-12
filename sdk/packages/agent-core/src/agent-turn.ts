// agent-turn.ts —— H.10: VisitorTurnAgent，agent-core 唯一的 agent 入口。
//
// H.9 backend (eino ADK) 接管 LLM ↔ tool loop 之后，浏览器只是 event
// consumer —— 单一 POST /api/v1/agent/turn，SSE 收整套事件 (text /
// tool_started / tool_completed / done / error)，分派给 observer 渲 UI 即可。
// (老的浏览器侧 VisitorAgent loop 已删，只剩 3 ports: prompts / turn / observer)

import type {
  DocContext,
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
  // docContext —— 访客当前所在 doc(在 doc 页/浮窗发问时);主 chat 全屏 = undefined。
  readonly docContext?: DocContext;
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
      docContext: this.cfg.docContext,
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
      ctx.cutStatus = readCutStatus(err);
    }
    this.emit({ type: 'iteration_completed', iter: 0 });
    // 一轮**算不算说完了**,判据是它的 `done` 尾帧到没到 —— 后端在每条路径末尾都无条件发它
    // (agent_loop.go:152,错误路径也发),所以缺了它就是**确定**没收尾。
    //
    // 这里以前判的是 `ctx.text === ''`:一个字都没收到才报。而「有文字」不等于「有答案」——
    // 真实环境里那段文字是模型的计划旁白(*"Let me peek at the remaining ~39 notes…"*),
    // 流在 done 之前断掉,于是那半句计划被当成完成的答案发布,访客那边没有任何提示,
    // 这一轮还算成功、照常计费(F-A-32)。后端早就有这个区分(它判的是 product 而不是
    // 累计文本),客户端这一侧从来没有。
    if (!ctx.sawDone && !ctx.errored) {
      ctx.errored = true;
      this.emit({ type: 'error', message: unfinishedMessage(ctx) });
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
      case 'ghost':
        this.emit({
          type: 'ghost_received', text: ev.text,
          targetWaypoint: ev.target_waypoint, ghostId: ev.ghost_id,
        });
        return;
      case 'retrying':
        this.emit({ type: 'retrying', attempt: ev.attempt });
        return;
      case 'done':
        // 尾帧本身不渲任何东西,但**它到没到**是这一轮唯一可靠的「说完了」凭据。
        ctx.sawDone = true;
        // 而它**怎么**结束的同样有人要:stop_reason=max_tokens 是"预算用完",不是"说完了"。
        // 以前这里只置 sawDone、把 stopReason 丢掉 —— 那就是这条信息断掉的地方(F-A-34)。
        this.emit({ type: 'turn_finished', stopReason: ev.stopReason });
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

// PARTIAL_ANSWER_MESSAGE —— 已经流出来一部分、但没收尾。**必须说出来**:一段没说完的话
// 沉默地留在屏幕上,读起来就是一个完整而错误的答案(F-A-32 里那半句是模型的计划旁白)。
const PARTIAL_ANSWER_MESSAGE =
  'This answer was cut off before it finished — what you see above is partial. Please ask again.';

// cutMessage —— 按掐断时的 HTTP status 选文案:401/403 → 重进;其它 → 重试。
function cutMessage(status: number): string {
  return status === 401 || status === 403 ? SESSION_EXPIRED_MESSAGE : STREAM_CUT_MESSAGE;
}

// unfinishedMessage —— 没收尾时说哪一句:已经流出来一部分 → 说它是残缺的;一个字都没有 →
// 按掐断时的 status 说「重进」还是「再试」。
function unfinishedMessage(ctx: TurnCtx): string {
  return ctx.text === '' ? cutMessage(ctx.cutStatus) : PARTIAL_ANSWER_MESSAGE;
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
  // sawDone —— 收到过 `done` 尾帧。这是「这一轮说完了」的**唯一**凭据:后端在每条路径末尾
  // 都无条件发它,所以没收到就是确定没收尾 —— 不管已经流出来多少字。
  sawDone: boolean;
  // cutStatus —— 掐断时若是非 2xx 响应,带上 HTTP status(401/403 等);否则 0。
  // 「断没断」不再单独记:done 帧到没到已经说明了一切,而抛错只是没收尾的**一种**方式
  // (另一种是流干净地结束却少了尾帧 —— 以前那一种连报都不会报)。
  cutStatus: number;
}

function makeCtx(): TurnCtx {
  return { text: '', errored: false, sawDone: false, cutStatus: 0 };
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
