// agent-turn.ts —— H.10: VisitorTurnAgent, agent-core's single agent entry point.
//
// After H.9 backend (eino ADK) took over the LLM <-> tool loop, the
// browser is just an event consumer —— a single POST /api/v1/agent/turn,
// receiving the whole event set over SSE (text / tool_started /
// tool_completed / done / error), dispatched to the observer to render the
// UI. (The old browser-side VisitorAgent loop is deleted; only 3 ports
// remain: prompts / turn / observer)

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
  // persona —— the **dynamic** part of this session's system prompt: the
  // role's persona body + this code's own prompt (#104) + name and
  // description of every authorized skill. The backend computes and sends
  // it down in /sessions (`system_prompt_persona`), because it varies by
  // role/code/skill and isn't a cacheable fragment, so it can't go through
  // the part id channel.
  //
  // It used to **never get spliced in at all**: composeSystemPrompt only
  // iterated over part ids, so the owner's configured persona, the code's
  // dedicated prompt, and the skill list all never reached the model —
  // skill_use needs the exact skill name, and with no list it could never
  // name one (F-A-36).
  readonly persona?: string;
  // conversationID is the UUID of the persisted chat row, sent on every
  // /agent/turn so backend tools (calendar_book / etc.) can find the
  // conversation it belongs to.
  readonly conversationID: string;
  // docContext —— the doc the visitor is currently on (when asking from a
  // doc page/floating panel); undefined for the main full-screen chat.
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

  // send —— runs one whole turn: assemble system prompt -> POST /agent/turn
  // -> receive SSE events -> emit observer events -> return the updated
  // message history (the caller holds onto it for the next call).
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
      // Stream cut mid-way: reader.read() rejects (proxy/server
      // write-deadline timeout, network hiccup ->
      // ERR_INCOMPLETE_CHUNKED_ENCODING), or the streamer throws right when
      // it gets the response because of a non-2xx status (401 session
      // expired / 403 etc.). Never let the conversation get stuck pending.
      ctx.cutStatus = readCutStatus(err);
    }
    this.emit({ type: 'iteration_completed', iter: 0 });
    // Whether a turn **counts as finished** is decided by whether its
    // `done` trailing frame arrived — the backend unconditionally sends it
    // at the end of every path (agent_loop.go:152, error paths included),
    // so missing it means the turn is **definitely** unfinished.
    //
    // This used to check `ctx.text === ''`: only flagged an error when not
    // a single character came back. But "has text" doesn't mean "has an
    // answer" — in the real environment that text can be the model's
    // planning narration (*"Let me peek at the remaining ~39 notes…"*),
    // with the stream cutting off before done, so that half-finished plan
    // gets published as the completed answer, the visitor gets no
    // indication anything went wrong, and the turn still counts as
    // successful and gets billed normally (F-A-32). The backend already
    // makes this distinction (it judges by the product, not the
    // accumulated text) — the client side never did.
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
        // The trailing frame itself renders nothing, but **whether it
        // arrived** is the only reliable evidence this turn "finished".
        ctx.sawDone = true;
        // And **how** it ended matters too: stop_reason=max_tokens means
        // "ran out of budget", not "finished speaking". This used to only
        // set sawDone and discard stopReason — that's where this
        // information got lost (F-A-34).
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

  // composeSystemPrompt —— fixed fragments (visitor-header + one section
  // per capability) come first, this session's dynamic persona comes
  // after. Order matters: persona is what the owner wrote for this
  // audience, so it should sit on top of the general instructions.
  private async composeSystemPrompt(): Promise<string> {
    const parts: string[] = [];
    for (const id of this.cfg.systemPromptPartIDs) {
      parts.push(await this.ports.prompts.load(id));
    }
    const persona = (this.cfg.persona ?? '').trim();
    if (persona !== '') parts.push(persona);
    return parts.join('\n\n');
  }

  private emit(event: AgentEvent): void {
    this.ports.observer?.onEvent(event);
  }
}

// STREAM_CUT_MESSAGE —— human-readable fallback shown to the visitor when
// the stream got cut and not a single character came back.
// Doesn't expose technical details like ERR_INCOMPLETE_CHUNKED_ENCODING.
const STREAM_CUT_MESSAGE =
  'The connection dropped before a reply came back. Please try asking again.';

// SESSION_EXPIRED_MESSAGE —— 401/403: session token is invalid (expired /
// instance reset / quota exhausted). Retrying won't help; the visitor needs
// to re-open the access link — say so explicitly instead of leaving them
// staring at "try again".
const SESSION_EXPIRED_MESSAGE =
  'Your session is no longer valid (it may have expired). Re-open your access link to continue.';

// PARTIAL_ANSWER_MESSAGE —— part of the answer already streamed in, but
// never finished. **Must be said out loud**: an unfinished sentence left
// silently on screen reads as a complete but wrong answer (in F-A-32, that
// half-sentence was the model's own planning narration).
const PARTIAL_ANSWER_MESSAGE =
  'This answer was cut off before it finished — what you see above is partial. Please ask again.';

// cutMessage —— picks the copy based on the HTTP status at the time of the
// cut: 401/403 -> re-open the link; anything else -> retry.
function cutMessage(status: number): string {
  return status === 401 || status === 403 ? SESSION_EXPIRED_MESSAGE : STREAM_CUT_MESSAGE;
}

// unfinishedMessage —— which line to show when unfinished: some text
// already streamed in -> say it's partial; nothing at all -> pick "re-open
// the link" or "try again" based on the status at the time of the cut.
function unfinishedMessage(ctx: TurnCtx): string {
  return ctx.text === '' ? cutMessage(ctx.cutStatus) : PARTIAL_ANSWER_MESSAGE;
}

// readCutStatus —— reads the HTTP status off the error thrown by the
// streamer (agent-adapters attaches it via Object.assign); returns 0 if
// not present.
function readCutStatus(err: unknown): number {
  if (err === null || typeof err !== 'object') return 0;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : 0;
}

interface TurnCtx {
  text: string;
  errored: boolean;
  // sawDone —— whether a `done` trailing frame was received. This is the
  // **only** evidence that "this turn finished": the backend
  // unconditionally sends it at the end of every path, so not receiving it
  // means it's definitely unfinished — regardless of how much text already
  // streamed in.
  sawDone: boolean;
  // cutStatus —— if the cut happened on a non-2xx response, the HTTP
  // status (401/403 etc.); otherwise 0.
  // "Was it cut" is no longer tracked separately: whether the done frame
  // arrived already tells the whole story, and throwing is only **one**
  // way of being unfinished (the other is the stream ending cleanly but
  // missing the trailing frame — which used to go unreported entirely).
  cutStatus: number;
}

function makeCtx(): TurnCtx {
  return { text: '', errored: false, sawDone: false, cutStatus: 0 };
}

// safeParseToolResult —— H.10: the backend agent loop stuffs the tool
// RunFn's raw return string straight into SSE tool_completed.result. Each
// tool's wire shape is heterogeneous:
//   - corpus_search/list: bare array  `[{path, title, genre, summary}]`
//   - corpus_read: flat object        `{genre, body, path, title}`
//   - calendar_list_slots: envelope   `{ok, slots: [...]}`
//   - calendar_book ok: envelope      `{ok, event_id, html_link, start, end}`
//   - calendar_book fail: envelope    `{ok: false, conflict, ...}`
//   - skill_* / ext_*: arbitrary JSON
//
// This layer only does:
//   - JSON.parse
//   - when the top level has `ok: boolean`, pass it through as result's ok
//     (shouldRenderCall filters out failed cards by c.ok); the result
//     field still passes through the whole parsed object (the consumer's
//     pickSlots / pickBookConfirmation narrow it themselves)
//
// Never unwrap `{ok, ...}` as if it were a {ok, result, reason} envelope
// by setting result = parsed.result —— that would misread {ok, slots} as
// {ok, result: undefined} and drop data (this is what the H.10 sweep hit,
// the regression where SlotsCard showed 0 slots).
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
