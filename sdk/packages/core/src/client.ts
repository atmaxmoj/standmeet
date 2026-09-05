// client.ts —— the createClient factory: given a baseURL, returns a set of
// business methods. Callers (Next.js SSR, React apps, Web Component embeds)
// only use the client instance and never write their own fetch / URL
// assembly.
//
// By design the client is a stateless, lightweight object; every method call
// issues a fresh fetch. The session token is kept by the caller and passed
// as a parameter into streamMessage.
//
// When baseURL is an empty string, every request goes through a relative
// path (letting Next rewrites / an app proxy pass it through); when
// non-empty, requests go through an absolute path (SSR, Web Component on a
// third-party domain).
//
// v1 is a single-owner instance —— the page / wiki landing / session APIs
// carry no handle parameter: the sole owner is resolved directly server-side.

import type {
  CorpusCard,
  MicrositeLink,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SessionMode,
  SSEEvent,
} from './types.js';

// ClientOptions —— createClient's input. baseURL defaults to an empty string.
export interface ClientOptions {
  baseURL?: string;
  fetchImpl?: typeof fetch;
}

// IssueSessionInput —— the unified input for the three session modes. mode
// decides which fields are required:
//   public —— no fields
//   code   —— code (+ visitor_name optional)
//   byoai  —— byoai_provider (key / endpoint / model are never uploaded to
//             the server; the browser keeps them in its own vault and sends
//             them through the chat header)
export interface IssueSessionInput {
  mode: SessionMode;
  code?: string;
  visitor_name?: string;
  // member_id —— the member id obtained last time; bring it along to
  // continue the session by id (especially for anonymous visitors) —— if
  // it's no longer valid, the backend automatically falls back to matching
  // by visitor_name / creating a new one.
  member_id?: string;
  byoai_provider?: string;
  // captcha_token —— a captcha ticket from a passed verification. **It's for
  // unlocking**: once the same IP crosses the threshold of consecutive
  // failed code attempts, the backend locks it for 15 minutes, and
  // presenting a valid ticket clears it immediately (see `code_guard.go`'s
  // `Locked = enabled && overThreshold && captchaFails`). When captcha is
  // disabled, the backend ignores this field.
  captcha_token?: string;
  // embed_token —— the widget's EdDSA JWT credential (anti-theft). Sending
  // it means **not** sending the plaintext code: the server verifies the
  // signature and looks the code up from it. The widget signs it fresh with
  // a per-embed private key, bound to origin + a short expiry + a one-time
  // jti.
  embed_token?: string;
}

// BYOAIHeaders —— the 4 headers streamMessage passes through when
// mode=byoai (**all required**, the server 401s if any is missing):
//   X-BYOAI-Provider —— preset name ('openai' / 'deepseek' / 'custom' / ...)
//   X-BYOAI-Endpoint —— base URL (without the /v1/... suffix)
//   X-BYOAI-Model    —— model id
//   X-BYOAI-Key      —— base64 (URL-safe, no padding) of the plaintext key
//                       after the caller derives an AES-256 key via HKDF
//                       from session_token and wraps it with AES-GCM
// The SDK takes no part in key wrapping; that's the caller's responsibility.
export interface BYOAIHeaders {
  provider: string;
  endpoint: string;
  model: string;
  wrappedKey: string;
}

// StandMeetClient —— the business interface. The instance a consumer gets
// from createClient satisfies this shape; internal fields aren't exposed
// directly.
export interface StandMeetClient {
  // fetchWikiLanding —— lang is optional: a multi-language note picks the
  // matching face by it; if this note has no such face, it falls back to
  // its identity language (`lang:`). **It's a query parameter, not a path
  // segment** —— not every note carries the same set of languages.
  fetchWikiLanding(slug: string, lang?: string): Promise<WikiLandingView | null>;
  fetchOutputLanding(slug: string): Promise<OutputLandingView | null>;
  // fetchCorpusCards —— every published corpus entry as a card (title + excerpt +
  // reader path). A page lists these to show corpus cards without hand-picking ids.
  fetchCorpusCards(): Promise<CorpusCard[]>;
  // fetchMicrosites —— the owner's OTHER published microsites (slug + title), so a page can
  // link the rest of the site without knowing their slugs. Empty on failure (degrade, no throw).
  fetchMicrosites(): Promise<MicrositeLink[]>;
  issueSession(input: IssueSessionInput): Promise<PublicSessionResponse>;
  streamMessage(
    conversationID: string,
    sessionToken: string,
    content: string,
    system: string,
    byoai?: BYOAIHeaders,
  ): AsyncGenerator<SSEEvent, void, unknown>;
  // composeSystem —— this session's system prompt (fragment + persona).
  // Composed once per session, reused for the whole session. Takes only
  // **the two fields it actually reads**, not the full issuance receipt: a
  // page adopting an already-existing session only has the few stored
  // items on hand, and this has never used quota / members.
  composeSystem(session: SystemPromptSource): Promise<string>;
  // queryMicrositeDocs —— read this page's own stored documents in a collection (a poll tally, a
  // sign-up list). Degrades to empty on failure — a read never throws.
  queryMicrositeDocs(slug: string, collection: string): Promise<MicrositeDoc[]>;
  // insertMicrositeDoc —— append one document to this page's store. Throws MicrositeStoreError on a
  // refusal (the store is closed, full, the doc is invalid) so the page can tell the visitor.
  insertMicrositeDoc(slug: string, collection: string, doc: MicrositeDoc): Promise<string>;
}

// MicrositeDoc —— an opaque JSON document a microsite stores (the SDK doesn't model its shape).
export type MicrositeDoc = Record<string, unknown>;

// MicrositeStoreError —— a write refusal, carrying the HTTP status + the server's code so the page can
// distinguish "closed" (403) from "full" (429) from "invalid" (400).
export class MicrositeStoreError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'MicrositeStoreError';
  }
}

// TurnMsg —— one history message sent to the backend (the wire shape of the
// backend's `ChatRequestMsg`).
export interface TurnMsg { role: 'user' | 'assistant'; content: string }

// maxHistoryMsgs —— how many messages to carry back. Enough to support
// pronoun references ("he", "it", "that") and a few rounds of follow-up,
// without letting the request grow unbounded with the conversation.
const maxHistoryMsgs = 24;

export function createClient(opts: ClientOptions = {}): StandMeetClient {
  const baseURL = opts.baseURL ?? '';
  const f = opts.fetchImpl ?? fetch;
  // histories —— one transcript per conversation, **kept by the client
  // itself** (F-O-7).
  //
  // Why this isn't just the Nth parameter of `streamMessage`: it used to not
  // even have this parameter —— `history: []` was hardcoded in the request
  // body, so all **three faces** of the SDK (core client, web component,
  // React bindings) were sending a conversation with no memory —— when the
  // second question said "he" or "it", the model had no idea who. Adding a
  // parameter would only turn "remember to pass it" into a discipline every
  // caller has to keep, and that exact discipline was just violated by all
  // three callers at once ([[structure-means-no-responsibility-class]]). So
  // memory belongs to the client instead —— a caller can't forget it even if
  // it wants to.
  const histories = new Map<string, TurnMsg[]>();
  return {
    fetchWikiLanding: (slug, lang) => fetchWikiLanding(f, baseURL, slug, lang),
    fetchOutputLanding: (slug) => fetchOutputLanding(f, baseURL, slug),
    fetchCorpusCards: () => fetchCorpusCards(f, baseURL),
    fetchMicrosites: () => fetchMicrosites(f, baseURL),
    issueSession: (input) => issueSession(f, baseURL, input),
    streamMessage: (id, token, content, system, byoai) =>
      streamMessage(f, baseURL, id, token, content, system, byoai, histories),
    composeSystem: (session) => composeSystem(f, baseURL, session),
    queryMicrositeDocs: (slug, collection) => queryMicrositeDocs(f, baseURL, slug, collection),
    insertMicrositeDoc: (slug, collection, doc) => insertMicrositeDoc(f, baseURL, slug, collection, doc),
  };
}

const micrositeStoreBase = '/api/v1/pages';

async function queryMicrositeDocs(
  f: typeof fetch, baseURL: string, slug: string, collection: string,
): Promise<MicrositeDoc[]> {
  try {
    const url = `${baseURL}${micrositeStoreBase}/${slug}/store?collection=${encodeURIComponent(collection)}`;
    const res = await f(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { docs?: MicrositeDoc[] };
    return body.docs ?? [];
  } catch {
    return [];
  }
}

async function insertMicrositeDoc(
  f: typeof fetch, baseURL: string, slug: string, collection: string, doc: MicrositeDoc,
): Promise<string> {
  const res = await f(`${baseURL}${micrositeStoreBase}/${slug}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, doc }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new MicrositeStoreError(
      res.status, body.error?.code ?? 'error', body.error?.message ?? 'could not save',
    );
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

// rememberTurn —— after a turn finishes, append "question + answer" to this
// session's transcript, trimming from the front once it's too long.
function rememberTurn(
  histories: Map<string, TurnMsg[]>, id: string, question: string, answer: string,
): void {
  if (answer === '') return; // No answer: skip history, don't carry a half-empty round forward
  const next = [...(histories.get(id) ?? []),
    { role: 'user' as const, content: question },
    { role: 'assistant' as const, content: answer }];
  histories.set(id, next.slice(-maxHistoryMsgs));
}

async function fetchWikiLanding(
  f: typeof fetch, baseURL: string, slug: string, lang?: string,
): Promise<WikiLandingView | null> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await f(`${baseURL}/api/v1/wiki/${slug}${q}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch wiki ${slug}: ${res.status}`);
  return (await res.json()) as WikiLandingView;
}

async function fetchOutputLanding(
  f: typeof fetch, baseURL: string, slug: string,
): Promise<OutputLandingView | null> {
  const res = await f(`${baseURL}/api/v1/output/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch output ${slug}: ${res.status}`);
  return (await res.json()) as OutputLandingView;
}

async function fetchCorpusCards(f: typeof fetch, baseURL: string): Promise<CorpusCard[]> {
  const res = await f(`${baseURL}/api/v1/corpus-cards`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch corpus cards: ${res.status}`);
  const body = (await res.json()) as { cards?: CorpusCard[] };
  return body.cards ?? [];
}

// fetchMicrosites —— the owner's published microsites. Degrades to [] on any failure (a
// nav widget that can't reach the list should simply render nothing, not crash the page).
async function fetchMicrosites(f: typeof fetch, baseURL: string): Promise<MicrositeLink[]> {
  try {
    const res = await f(`${baseURL}/api/v1/microsites`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { pages?: MicrositeLink[] };
    return body.pages ?? [];
  } catch {
    return [];
  }
}

async function issueSession(
  f: typeof fetch, baseURL: string, input: IssueSessionInput,
): Promise<PublicSessionResponse> {
  const res = await f(`${baseURL}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // The backend's error envelope is `{"error":{"code","message"}}`, but the
    // previous version read the top-level `body.code` —— that field never
    // existed, so code was always an empty string and message got dropped
    // entirely. The envelope's "this code is full — no more names available"
    // is **written for the visitor to read**, yet it never reached the
    // screen: the gate was left with just a boolean, calling every failure
    // "unknown code" —— someone holding a valid invitation, just out of
    // available names, was told their code didn't exist (F-A-23). Carry both
    // code and message.
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: unknown; message?: unknown };
    };
    const env = body.error ?? {};
    throw Object.assign(new Error(`issue session: ${res.status}`), {
      status: res.status,
      code: typeof env.code === 'string' ? env.code : '',
      serverMessage: typeof env.message === 'string' ? env.message : '',
    });
  }
  return (await res.json()) as PublicSessionResponse;
}

// streamMessage —— one conversational turn, going through
// **POST /api/v1/agent/turn**: the same path the owner's own page uses.
//
// It used to hit `/api/v1/llm/chat/stream`, with `system: ''` in the body,
// and a comment that still read "No tool loop; this is a single-turn smoke
// test path" —— that path is a **retired** bare model proxy (the backend's
// routes/public/chat.go:109-110 spells it out: it was retired once the SDK
// switched over). The app side had already switched; the SDK side hadn't ——
// so **the component shipped for other people to embed in their own sites**
// had no retrieval, no tools, no persona: asked "what is this corpus for" on
// a foreign-origin page, it answered with an NLP-textbook definition (F-O-2).
//
// system is passed in by the caller: it has to call `composeSystem(session)`
// first to assemble this session's fragment + persona. It's not composed
// secretly in here, because that would cost extra HTTP round trips, and a
// caller usually composes once per session and reuses it for the whole
// session.
async function* streamMessage(
  f: typeof fetch, baseURL: string,
  conversationID: string, sessionToken: string, content: string,
  system: string, byoai: BYOAIHeaders | undefined,
  histories: Map<string, TurnMsg[]>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const res = await f(`${baseURL}/api/v1/agent/turn`, {
    method: 'POST',
    headers: buildMessageHeaders(sessionToken, byoai),
    body: JSON.stringify({
      system,
      user_message: content,
      conversation_id: conversationID,
      // What was said earlier in this session (F-O-7). The backend uses
      // `req.History` to assemble the model messages, and **won't**
      // backfill it by conversation_id —— leave this empty and the model
      // will forever be answering a conversation that just started.
      history: histories.get(conversationID) ?? [],
    }),
  });
  // The status code hangs off the error, not just folded into message (F-O-5).
  //
  // The caller needs to **classify** the failure to talk about it: 429 means
  // "this session is busy right now" —— the previous turn is still
  // streaming, wait for it to finish and ask again; everything else is
  // something different. This used to just be
  // `new Error('send message: 429')`, so the embed side had a single catch
  // that collapsed every failure into "didn't send, try again" —— **it did
  // send, and retrying immediately just gets rejected again**
  // ([[collapsed-error-class-kills-its-own-branch]]).
  // `issueSession` in this same file already did it this way; this one just
  // hadn't caught up.
  if (!res.ok || !res.body) {
    throw await turnError(res);
  }
  // Accumulate this turn's answer as it streams, then append it to the
  // transcript when it finishes —— the next turn carries it forward.
  let answer = '';
  for await (const ev of translateAgentSSE(res.body)) {
    if (ev.kind === 'token') answer += ev.text;
    yield ev;
  }
  rememberTurn(histories, conversationID, content, answer);
}

// turnError —— the error thrown when a turn is rejected. **message is
// exactly the sentence the backend wrote for the reader.**
//
// The previous version threw `send message: 403` —— the status code
// survived, the sentence was thrown away —— and what the caller renders is
// exactly `error.message`, so every page built on this SDK greeted its
// reader with a number: "quota exhausted", "code revoked", "session busy",
// all showing up as three digits on screen (F-P-5). `issueSession` in this
// same file had already been reading the envelope out; this one just hadn't
// caught up.
//
// status / code still hang off the error: the caller needs them to
// **classify** (429 means "this session is busy right now", wait for it to
// finish and ask again) —— not the wording of the sentence. Falling back to
// the status-code sentence only happens when the envelope can't be read.
async function turnError(res: Response): Promise<Error> {
  const env = await readErrEnvelope(res);
  const said = typeof env.message === 'string' ? env.message.trim() : '';
  return Object.assign(new Error(said === '' ? `send message: ${res.status}` : said), {
    status: res.status,
    code: typeof env.code === 'string' ? env.code : '',
    serverMessage: said,
  });
}

interface ErrEnvelope { code?: unknown; message?: unknown }

// readErrEnvelope —— the sentence the backend wrote for the reader,
// **recognizing both envelope shapes**.
//
// A rejected turn lands in one of two shapes:
//   - stream never opened → `text/event-stream` +
//     `event: error / data: {code, message}`
//     (`llm_chat_stream.go`'s `writeLLMPreStreamErr`)
//   - everything else → `{"error": {code, message}}`
//
// This used to read only the latter. The former makes `res.json()` throw
// directly, swallowed by `.catch` into an empty envelope, falling back to
// `send message: 503` —— exactly the thing this function's comment claims
// it fixed (F-P-5: greeting the reader with three digits). And provider-side
// errors **all** go through the former envelope shape. The same blind spot
// on the sibling path is at `streamAgentTurnHTTP` in `agent-adapters.ts`.
async function readErrEnvelope(res: Response): Promise<ErrEnvelope> {
  const raw = await res.text().catch(() => '');
  if (raw === '') return {};
  const direct = parseErrJSON(raw);
  if (direct !== null) return direct.error ?? direct;
  // SSE: take the data line from the `event: error` frame.
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const frame = parseErrJSON(line.slice('data:'.length).trim());
    if (frame !== null) return frame.error ?? frame;
  }
  return {};
}

function parseErrJSON(s: string): (ErrEnvelope & { error?: ErrEnvelope }) | null {
  try {
    const v: unknown = JSON.parse(s);
    return v !== null && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// composeSystem —— this session's system prompt: first fetches the fixed
// fragments segment by segment via `system_prompt_part_ids` (visitor-header
// + one segment per capability), then appends this session's **dynamic**
// persona segment after them (role persona + this code's own prompt + the
// granted skill list). Order matters: persona is what the owner wrote for
// this audience, layered on top of the general instructions —— identical to
// the path in agent-core, except that one serves a React host.
// SystemPromptSource —— everything needed to compose this session's system
// prompt.
export interface SystemPromptSource {
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
}

async function composeSystem(
  f: typeof fetch, baseURL: string, session: SystemPromptSource,
): Promise<string> {
  const parts: string[] = [];
  for (const id of session.system_prompt_part_ids ?? []) {
    // Encode one path **segment** at a time: an id looks like
    // `capabilities/corpus.retrieval`, and encoding the whole string would
    // turn the slash into %2F, missing the route match → 404 → this segment
    // silently dropped, and the model misses a whole block of instructions.
    const path = id.split('/').map(encodeURIComponent).join('/');
    const res = await f(`${baseURL}/api/v1/prompts/${path}`);
    if (res.ok) parts.push((await res.text()).trim());
  }
  const persona = (session.system_prompt_persona ?? '').trim();
  if (persona !== '') parts.push(persona);
  return parts.filter((p) => p !== '').join('\n\n');
}

// translateAgentSSE —— agent turn's SSE → this SDK's events. `text` / `done`
// / `error` map directly across; the agent path also sends `tool_started` /
// `tool_completed` / `ghost` / `retrying`, which **this minimal consumer
// ignores for now** (embed only renders text). Ignoring isn't dropping: a
// host that wants to render tool cards should use the agent-core path
// instead.
//
// **Wraps up and releases the connection the moment `done` arrives**
// (F-A-42). This used to keep reading until EOF —— but the backend still
// runs an epilogue after `done` (ghost is a real LLM call, measured at
// 10–26 seconds in prod), so the stream is of course still open. The
// caller's `for await` would then never return, and the widget's input box
// stayed locked for that whole extra stretch: **mistaking the stream's
// lifetime for the turn's lifetime**
// ([[nonunique-signal-not-a-receipt]]). This minimal consumer was never
// going to render ghost anyway, so there's no reason for it to hold open
// someone else's page's connection for a frame it's going to discard. A
// host that wants ghost / tool cards should use the agent-core path, which
// reads to the end of the stream itself.
async function* translateAgentSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.at(-1) ?? '';
    for (let i = 0; i < parts.length - 1; i++) {
      const ev = parseFrameToToken(parts[i] ?? '');
      if (ev === null) continue;
      yield ev;
      if (ev.kind === 'done') {
        await reader.cancel();
        return;
      }
    }
  }
}

function parseFrameToToken(raw: string): SSEEvent | null {
  let evType = ''; let evData = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) evType = line.slice(7).trim();
    else if (line.startsWith('data: ')) evData = line.slice(6).trim();
  }
  if (evType === 'text') {
    const d = safeParse(evData) as { delta?: string };
    if (d.delta) return { kind: 'token', text: d.delta };
    return null;
  }
  if (evType === 'done') {
    return {
      kind: 'done',
      cited_wiki_ids: [], cited_output_ids: [],
      cited_wiki_refs: [], cited_output_refs: [],
    };
  }
  if (evType === 'error') {
    const d = safeParse(evData) as { message?: string; code?: string };
    return { kind: 'error', code: d.code ?? 'inference_error', message: d.message ?? 'error' };
  }
  return null;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

function buildMessageHeaders(
  sessionToken: string, byoai: BYOAIHeaders | undefined,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
  return byoai
    ? {
      ...base,
      'X-BYOAI-Provider': byoai.provider,
      'X-BYOAI-Endpoint': byoai.endpoint,
      'X-BYOAI-Model': byoai.model,
      'X-BYOAI-Key': byoai.wrappedKey,
    }
    : base;
}
