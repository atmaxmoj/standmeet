// agent-adapters.ts —— browser host adapters for @standmeet/agent-core.
// After H.10 the agent loop moved into the backend (eino ADK), so the browser
// only needs 2 adapters:
//   - httpPromptSource     —— HTTP GET /api/v1/prompts/{id}
//   - httpAgentTurnStreamer —— POST /api/v1/agent/turn SSE, gets the whole turn's events in one call
// (the old LLMStreamer / ToolDispatcher / scripted mock paths were removed along with VisitorAgent)

import type {
  AgentTurnEvent,
  PromptSource,
  TurnRecovery,
  TurnRequest,
  TurnStreamer,
} from '@standmeet/agent-core';

import { parseAgentTurnSSE } from './agent-turn-sse';

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

// ───── BYOAI envelope headers ──────────────────────────────────────
//
// In byoai mode the visitor browser holds a plaintext key + HKDF(session_token)
// derives an AES key envelope, carried over via X-BYOAI-* headers; the server
// unwraps it, uses it once, and discards it.

export interface HttpBYOAIHeaders {
  readonly provider: string;
  readonly wrappedKey: string; // base64 url-safe no-pad envelope
  readonly endpoint: string;
  readonly model: string;
}

// ───── TurnStreamer (HTTP, prod): POST /api/v1/agent/turn ─────────
//
// H.10: the backend (eino ADK) took over the agent loop; the browser now calls
// /agent/turn once and receives the whole set of events over SSE
// (text / tool_started / tool_completed / done / error).

export interface HttpAgentTurnStreamerOptions {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly byoai?: HttpBYOAIHeaders;
}

export function httpAgentTurnStreamer(
  opts: HttpAgentTurnStreamerOptions,
): TurnStreamer {
  return {
    stream(req: TurnRequest): AsyncIterable<AgentTurnEvent> {
      return streamAgentTurnHTTP(opts, req);
    },
  };
}

async function* streamAgentTurnHTTP(
  opts: HttpAgentTurnStreamerOptions, req: TurnRequest,
): AsyncIterable<AgentTurnEvent> {
  const res = await fetch(`${opts.baseURL}/api/v1/agent/turn`, {
    method: 'POST',
    headers: turnHeaders(opts),
    body: JSON.stringify({
      system: req.system,
      user_message: req.userMessage,
      conversation_id: req.conversationID,
      history: req.history,
      // doc_context —— the current doc (title/path/genre); the backend injects it
      // into the instruction to ground reference resolution. When undefined,
      // JSON.stringify just drops it (the full-screen main chat doesn't send one).
      doc_context: req.docContext,
      // #120: visitor browser timezone, sent on every turn. The backend anchors it
      // into the general instruction so the agent interprets any time it states
      // (booking in particular) in the visitor's timezone, instead of hedging or
      // asking back.
      visitor_timezone: browserTimezone(),
    }),
  });
  if (res.body === null) {
    // Attach the HTTP status to the error so the layer above (agent-core send)
    // can tell 401/403 (session expired → prompt to re-enter) apart from a real
    // connection drop.
    throw statusError(res.status);
  }
  // **Even a non-2xx response must have its body read to completion.**
  //
  // Every pre-stream error the backend produces is written as
  // `text/event-stream` + non-2xx + `event: error / data: {code, message}`
  // (`writeLLMPreStreamErr` in `llm_chat_stream.go`), and `message` is
  // **the sentence written specifically for the reader** — eight of them, each
  // naming its own cause: owner_unconfigured / overloaded / network / timeout /
  // rate_limited / unsupported_provider / invalid_api_key / endpoint_blocked.
  //
  // This used to be `if (!res.ok) throw`: it threw before reading a single byte
  // of the body, so none of those eight sentences ever reached the screen — they
  // all collapsed into agent-core's status-code guess fallback (the visitor half
  // of F-A-24). The incident: a prod instance right after claim — the backend
  // returned 503 + "This page doesn't have an AI provider set up yet.", but the
  // visitor read "Connection lost, try again" — the connection was fine, and
  // retrying ten thousand times produces the same sentence. The 401 case is
  // worse: the owner's key is broken, and the product tells the visitor "your
  // session expired, reopen the access link."
  //
  // **The reason the server wrote for itself always beats a guess from the status
  // code.** Fall back to the status-code path only when the envelope is empty
  // ([[collapsed-error-class-kills-its-own-branch]]).
  let sawEvent = false;
  for await (const ev of parseAgentTurnSSE(res.body)) {
    sawEvent = true;
    yield ev;
  }
  // Body carried nothing at all (a non-SSE 502 page / an empty response) → the
  // 401/403 branch still has to stay: it's the line between "re-enter" and
  // "retry," and in that case there really is no other credential to go on.
  if (!res.ok && !sawEvent) throw statusError(res.status);
}

function statusError(status: number): Error {
  return Object.assign(new Error(`agent.turn: ${status}`), { status });
}

// browserTimezone —— the visitor's IANA tz (Intl…timeZone). When the
// environment can't provide it → empty string (the backend falls back to
// phrasing that asks the visitor for their timezone first).
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function turnHeaders(opts: HttpAgentTurnStreamerOptions): HeadersInit {
  const base: Record<string, string> = {
    Authorization: `Bearer ${opts.sessionToken}`,
    'Content-Type': 'application/json',
  };
  return opts.byoai ? { ...base, ...byoaiToHeaders(opts.byoai) } : base;
}

function byoaiToHeaders(b: HttpBYOAIHeaders): Record<string, string> {
  return {
    'X-BYOAI-Provider': b.provider,
    'X-BYOAI-Key': b.wrappedKey,
    'X-BYOAI-Endpoint': b.endpoint,
    'X-BYOAI-Model': b.model,
  };
}

// ───── TurnRecovery (HTTP): pull a dropped turn's persisted answer ─────
//
// K (owner-reported): a mid-stream SSE drop (network jitter) leaves the visitor
// with a half-answer and no way back but a manual refresh. The backend, though,
// ran the turn on a detached context (`agent_turn.go:136`) and persisted it — so
// what a refresh recovers, this recovers automatically: poll the conversation
// aggregate (GET /api/v1/conversations/{id}) until this turn's answer has landed.
// The turn is never re-run; there is no regeneration.

export interface HttpTurnRecoveryOptions {
  readonly baseURL: string;
  readonly sessionToken: string;
  // attempts / delayMs —— how long to wait for the backend to finish and persist
  // after the drop. Defaults suit network jitter (a few seconds), and are bounded
  // so a genuine server failure still falls through to the honest cut error.
  readonly attempts?: number;
  readonly delayMs?: number;
}

// Bounded so a genuinely lost turn (nothing persisted) still gives up quickly and lets the
// honest cut-error render: ~6s total. A real drop's turn has usually persisted within a second
// or two of the drop (the backend was already near done), so a few short polls recover it.
const RECOVERY_ATTEMPTS = 6;
const RECOVERY_DELAY_MS = 1000;

export function httpTurnRecovery(opts: HttpTurnRecoveryOptions): TurnRecovery {
  const attempts = opts.attempts ?? RECOVERY_ATTEMPTS;
  const delayMs = opts.delayMs ?? RECOVERY_DELAY_MS;
  return {
    async recover(conversationID: string, userMessage: string): Promise<string | null> {
      for (let i = 0; i < attempts; i++) {
        const answer = await fetchPersistedAnswer(opts, conversationID, userMessage);
        if (answer !== null) return answer;
        await sleep(delayMs);
      }
      return null;
    },
  };
}

async function fetchPersistedAnswer(
  opts: HttpTurnRecoveryOptions, conversationID: string, userMessage: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${opts.baseURL}/api/v1/conversations/${conversationID}`, {
      headers: { Authorization: `Bearer ${opts.sessionToken}` },
    });
    if (!res.ok) return null;
    return lastAnswerFor(await res.json(), userMessage);
  } catch {
    return null;
  }
}

// lastAnswerFor —— the just-cut turn is always the LAST dialog once the backend
// persists it (the visitor can't ask again while this one is pending). Return
// its answer only when that last dialog is this turn (question matches) and
// actually carries text; otherwise it hasn't landed yet → keep polling.
function lastAnswerFor(body: unknown, userMessage: string): string | null {
  const dialogs = dialogsOf(body);
  const last = dialogs.at(-1);
  if (last === undefined) return null;
  const isThisTurn = last.question.trim() === userMessage.trim() && last.answer !== '';
  return isThisTurn ? last.answer : null;
}

function dialogsOf(body: unknown): { question: string; answer: string }[] {
  if (body === null || typeof body !== 'object') return [];
  const conv = (body as { conversation?: unknown }).conversation;
  if (conv === null || typeof conv !== 'object') return [];
  const raw = (conv as { dialogs?: unknown }).dialogs;
  return Array.isArray(raw) ? raw.filter(isDialog) : [];
}

function isDialog(d: unknown): d is { question: string; answer: string } {
  if (d === null || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return typeof r['question'] === 'string' && typeof r['answer'] === 'string';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
