// api —— the visitor chat's calls to the backend's public protocol: issue a session, read a
// conversation back, open a per-document thread, call a card's tool. Every chat surface (the app
// room, a microsite agent, the embed) goes through these, so each call exists once.
//
// baseURL: the browser uses a relative path (same origin as the instance). A host on another
// origin (the embed) sets it once with setChatBaseURL.

import { z } from 'zod';
import { createClient } from '@standmeet/sdk-core';

let configuredBase = '';

// setChatBaseURL —— the instance origin for a host that is not the instance (the embed on a
// third-party site). The app and microsites are on the instance itself and never call it.
export function setChatBaseURL(base: string): void {
  configuredBase = base.replace(/\/+$/, '');
}

export function chatBaseURL(): string {
  return configuredBase;
}

function client(): ReturnType<typeof createClient> {
  return createClient({ baseURL: chatBaseURL() });
}

// v1 single-owner instance —— session input carries no handle.
export interface IssueCodeSessionInput {
  code: string;
  visitor_name?: string;
  visitor_email?: string; // optional; the email entered at entry → session profile
  member_id?: string;
}

// BYOAI key / endpoint / model are never persisted on any server layer anymore;
// the session only sends the provider name for conversation audit. The plaintext
// key + endpoint + model go into the browser vault;
// each chat derives an AES key from session_token, stuffs an AES-GCM envelope
// into the X-BYOAI-Key header, with endpoint / model going in two more headers.
export interface IssueBYOAISessionInput {
  byoai_provider: string;
}

export const issuePublicSession = () => client().issueSession({ mode: 'public' });
export const issueCodeSession = (input: IssueCodeSessionInput) =>
  client().issueSession({ ...input, mode: 'code' });
export const issueBYOAISession = (input: IssueBYOAISessionInput) =>
  client().issueSession({ ...input, mode: 'byoai' });

// Conversation aggregate read model (GET /conversations/<id>). The concept has
// three layers, code → session → conversation, and the session token finds the
// conversation. The frontend hydrates it all in one shot on load.
const GhostSchema = z.object({ text: z.string(), selected: z.boolean() });
const DialogCitationSchema = z.object({
  genre: z.enum(['wiki', 'output']),
  path: z.string(),
  title: z.string(),
});
// ToolCallSchema —— one tool call within the conversation aggregate.
//
// result **must be optional**: since F-A-28, results from the retrieval family
// (corpus_*) are stripped before being sent down to the visitor (that's note
// body text, some of it private), leaving only name + ok. But in zod v4,
// `z.unknown()` inside an object is **non-optional** — a missing key throws
// `expected nonoptional, received undefined`, which fails the **entire**
// aggregate's safeParse, sends fetchConversation to 'error', and
// restoreSession returns silently — the visitor sees a blank transcript on
// refresh: their whole conversation just disappeared.
//
// result for non-retrieval tools (booker report cards / summarize / skill_* /
// ext_*) is still present as usual, and those cards need it to re-render after
// a refresh, so this field can't just be deleted here — it can only be
// loosened.
const ToolCallSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
});
const AggDialogSchema = z.object({
  created_at: z.string(),
  question: z.string(),
  answer: z.string(),
  ghosts: z.array(GhostSchema),
  citations: z.array(DialogCitationSchema),
  tool_calls: z.array(ToolCallSchema),
});
// ConvEventSchema —— a record of an in-card action. It isn't anyone's spoken
// text, so it doesn't go into dialogs: that shape is question-and-answer, and
// forcing it in would break the pairing.
const ConvEventSchema = z.object({ created_at: z.string(), text: z.string() });
const ViewSchema = z.object({
  session: z.object({
    visitor_name: z.string(),
    // used_turns —— member-level turns used (the backend sums across all of
    // this person's conversations). The frontend strip shows "used" from this,
    // no longer counting local dialogs on a single surface (which undercounts
    // with multiple conversations).
    used_turns: z.number().optional().default(0),
    code: z.object({
      max_turns_per_session: z.number(),
      max_members: z.number(),
      member_count: z.number(),
    }),
  }),
  conversation: z.object({
    dialogs: z.array(AggDialogSchema),
    started_at: z.string(),
    // events —— **things that happened** in this conversation (the visitor
    // cancelled a booking / sent a confirmation, from a card). optional: an
    // older instance's response (not yet sending this field) must not fail the
    // whole safeParse over it — that would leave the visitor seeing a blank
    // transcript after refresh (same lesson as ToolCallSchema.result).
    events: z.array(ConvEventSchema).optional().default([]),
  }),
});
export type DialogCitation = z.infer<typeof DialogCitationSchema>;
export type AggDialog = z.infer<typeof AggDialogSchema>;
export type ConvEvent = z.infer<typeof ConvEventSchema>;

// VisitorView —— the camelCase shape after parsing the endpoint response.
// session (identity + code quota) + conversation (dialogs / ended / summary).
// count is derived from dialogs.length, it doesn't carry its own field.
export interface VisitorView {
  visitorName: string;
  maxTurns: number;
  usedTurns: number;
  maxMembers: number;
  memberCount: number;
  dialogs: AggDialog[];
  // events —— must be folded back into **the message list the model sees**
  // after a refresh, otherwise a booking cancelled from a card gets forgotten
  // by the agent again when the page is reopened (F-B-9).
  events: ConvEvent[];
}

// ConversationResult —— three states: alive / invalidated (401/403, needs
// re-entry) / flaky (keep current state). A dead session must not be silently
// swallowed as an empty history — the stale identity has to be cleared, and
// the visitor sent back to the entry point that matches whether they have a
// code.
export type ConversationResult =
  | { status: 'ok'; view: VisitorView }
  | { status: 'invalid' }
  | { status: 'error' };

// openDocConversation —— multi-conversation model: the floating window
// find-or-creates this member's own conversation on a given doc
// (POST /conversations {doc_key}). Returns conversation_id; returns null on
// failure (caller falls back to the main conversation, doesn't crash).
// Idempotent: reopening the same doc returns the same conversation.
export async function openDocConversation(
  docKey: string, sessionToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ doc_key: docKey }),
    });
    if (!res.ok) return null;
    const parsed = z.object({ conversation_id: z.string() }).safeParse(await res.json());
    return parsed.success ? parsed.data.conversation_id : null;
  } catch {
    return null;
  }
}

// fetchConversation —— fetches the conversation aggregate with a session token
// (GET /conversations/<id>). 401/403 = token invalidated (expired / instance
// reset / revoked) → 'invalid'; any other non-2xx / network failure / wrong
// shape → 'error' (keep the current state, don't crash).
export async function fetchConversation(
  conversationID: string, sessionToken: string,
): Promise<ConversationResult> {
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/conversations/${conversationID}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.status === 401 || res.status === 403) return { status: 'invalid' };
    if (!res.ok) return { status: 'error' };
    const parsed = ViewSchema.safeParse(await res.json());
    return parsed.success
      ? { status: 'ok', view: toView(parsed.data) }
      : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

// fetchLiveConversation —— the conversation a live-transcript link opens (GET /live/<token>), its
// dialogs so far; null for a link that is not valid (tampered, expired) or a failed read.
export async function fetchLiveConversation(token: string): Promise<AggDialog[] | null> {
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/live/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const parsed = z.object({ conversation: ViewSchema.shape.conversation }).safeParse(await res.json());
    return parsed.success ? parsed.data.conversation.dialogs : null;
  } catch {
    return null;
  }
}

// openLiveStream —— the live link's SSE body (null when it cannot be opened).
export async function openLiveStream(
  token: string, signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const url = `${chatBaseURL()}/api/v1/live/${encodeURIComponent(token)}/stream`;
    const res = await fetch(url, { method: 'POST', signal });
    return res.ok ? res.body : null;
  } catch {
    return null;
  }
}

function toView(d: z.infer<typeof ViewSchema>): VisitorView {
  return {
    visitorName: d.session.visitor_name,
    maxTurns: d.session.code.max_turns_per_session,
    usedTurns: d.session.used_turns,
    maxMembers: d.session.code.max_members,
    memberCount: d.session.code.member_count,
    dialogs: d.conversation.dialogs,
    events: d.conversation.events,
  };
}

// callVisitorTool —— mcp-ui:tool dispatch for a booked card: calls a named
// tool (calendar_cancel / send_confirmation) using the visitor session. The
// host dispatches with session context (conversation + token) attached, and
// returns the tool result wire ({ok,...}). A bad response / network failure →
// {ok:false,error}, and the card goes into its error terminal state from that.
export async function callVisitorTool(
  conversationID: string, sessionToken: string,
  name: string, args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (conversationID === '' || sessionToken === '' || name === '') {
    return { ok: false, error: 'unavailable' };
  }
  try {
    const res = await fetch(
      `${chatBaseURL()}/api/v1/sessions/${conversationID}/tools/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(args),
      },
    );
    const body: unknown = await res.json();
    if (!isRecordValue(body)) return { ok: false, error: 'bad_response' };
    // /tools envelope is {ok, result:<tool wire>, reason}. The card wants the tool
    // wire (result); a dispatch failure (no result — expired session / quota) →
    // return the envelope itself (ok:false + reason) so the card degrades in-card.
    return isRecordValue(body['result']) ? body['result'] : body;
  } catch {
    return { ok: false, error: 'network' };
  }
}

// codeStillOpens —— whether an access code still admits a visitor (POST /codes/intro), without
// opening a session or claiming a name. A refusal (revoked, expired, unknown) → false; a network
// failure → true, so a passing hiccup never throws a valid code away.
export async function codeStillOpens(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/codes/intro`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    return res.ok || res.status >= 500;
  } catch {
    return true;
  }
}

// voiceAvailable —— whether this instance turns recordings into text (GET /voice). Any failure → no
// (the composer simply offers no mic).
export async function voiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/voice`);
    const body: unknown = res.ok ? await res.json() : null;
    return isRecordValue(body) && body['available'] === true;
  } catch {
    return false;
  }
}

// TranscribeResult —— the text, or the server's machine code for why not (voice_busy,
// recording_too_long, bad_recording…; 'network' when nothing came back).
export type TranscribeResult = { ok: true; text: string } | { ok: false; code: string };

// transcribeRecording —— POST /transcribe with the visitor's session (the cookie on the instance's
// own origin; the bearer token for a host on another origin).
export async function transcribeRecording(audio: Blob, sessionToken: string): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('audio', audio, 'speech.wav');
  try {
    const res = await fetch(`${chatBaseURL()}/api/v1/transcribe`, {
      method: 'POST', credentials: 'include', body: form,
      headers: sessionToken === '' ? {} : { Authorization: `Bearer ${sessionToken}` },
    });
    const body: unknown = await res.json().catch(() => null);
    return transcribeResult(res.ok, body);
  } catch {
    return { ok: false, code: 'network' };
  }
}

function transcribeResult(ok: boolean, body: unknown): TranscribeResult {
  const record = isRecordValue(body) ? body : {};
  const err = isRecordValue(record['error']) ? record['error'] : {};
  return ok && typeof record['text'] === 'string'
    ? { ok: true, text: record['text'] }
    : { ok: false, code: typeof err['code'] === 'string' ? err['code'] : 'network' };
}

// isRecordValue —— narrows res.json()'s unknown down to a Record (avoids an
// `as` assertion, satisfies eslint consistent-type-assertions).
function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
