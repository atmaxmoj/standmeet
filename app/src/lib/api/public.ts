// public.ts —— the app's entry point into the backend's public protocol; reuses
// @standmeet/sdk-core's client, keeping Next-specific baseURL resolution (SSR
// vs browser) in a single factory.
// dogfood: the app runs the SDK itself, proving the SDK is actually good to use.
//
// Important: this layer only exposes a thin "client with baseURL configured +
// compatible re-exports". Components never import @standmeet/sdk-core directly;
// everything routes through here so it's easy to adjust later.

import { createClient } from '@standmeet/sdk-core';

import {
  EMPTY_TREE_CONTEXT, TreeContextSchema, TreeResponseSchema,
  type TreeContext, type TreeNode,
} from '@/lib/corpus/tree';
import type {
  BYOAIHeaders,
  IssueSessionInput,
  PublicSessionResponse,
  StandMeetClient,
  SSEEvent,
} from '@standmeet/sdk-core';

export type {
  BYOAIHeaders,
  PagePinCard,
  PageWhere,
  PageContact,
  PageContent,
  PublicOwnerView,
  PublicPageView,
  WikiLandingView,
  LanguageOption,
  OutputLandingView,
  PublicSessionResponse,
  SSEEvent,
  SessionMode,
} from '@standmeet/sdk-core';

// client / SSR baseURL switch: server components go over the container network
// to backend:8000, the browser uses a relative path (Next rewrites forward it
// to the backend). Centralized in one factory so each call site doesn't
// re-decide it.
// baseURL —— the client uses a relative path (Next rewrites forward it to the
// backend), SSR uses the container network. booking.ts also reuses this, hence
// exported.
export function baseURL(): string {
  if (typeof window === 'undefined') {
    return process.env['BACKEND_URL'] ?? 'http://backend:8000';
  }
  return '';
}

function client(): StandMeetClient {
  return createClient({ baseURL: baseURL() });
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
// key + endpoint + model go into the browser vault (lib/gate/byoai-vault.ts);
// each chat derives an AES key from session_token, stuffs an AES-GCM envelope
// into the X-BYOAI-Key header, with endpoint / model going in two more headers.
export interface IssueBYOAISessionInput {
  byoai_provider: string;
}

export const fetchPublicPage = () => client().fetchPage();
// fetchWikiLanding —— lang is optional: for a multilingual note the server
// already picks the right side (so SSR also has the correct copy; crawlers and
// agents fetch the actual content, not a skeleton waiting on JS).
export const fetchWikiLanding = (slug: string, lang?: string) =>
  client().fetchWikiLanding(slug, lang);
export const fetchOutputLanding = (slug: string) => client().fetchOutputLanding(slug);

// CodeIntro —— code intro fetched by the name picker pre-issue (greeting +
// member cap/used count).
const CodeIntroSchema = z.object({
  label: z.string(),
  greeting: z.string(),
  max_members: z.number(),
  member_count: z.number(),
});
export type CodeIntro = z.infer<typeof CodeIntroSchema>;

// fetchCodeIntro —— the code goes in the body (kept out of URL logs). A bad
// code / network failure / wrong shape → null; the picker degrades gracefully
// (shows only the default form).
export async function fetchCodeIntro(code: string): Promise<CodeIntro | null> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/codes/intro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const parsed = CodeIntroSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
    const res = await fetch(`${baseURL()}/api/v1/conversations`, {
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

// The two POSTs for a booked card (confirmation email / cancel) live in
// api/booking.ts to stay under the 350-line cap.

// fetchConversation —— fetches the conversation aggregate with a session token
// (GET /conversations/<id>). 401/403 = token invalidated (expired / instance
// reset / revoked) → 'invalid'; any other non-2xx / network failure / wrong
// shape → 'error' (keep the current state, don't crash).
export async function fetchConversation(
  conversationID: string, sessionToken: string,
): Promise<ConversationResult> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/conversations/${conversationID}`, {
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

// VisitorDoc —— the full text of a cited document, fetched via corpus_read
// with a visitor session for the lockscreen page.
const VisitorDocSchema = z.object({
  ok: z.boolean(),
  result: z.object({ body: z.string(), title: z.string() }),
});
export interface VisitorDoc { title: string; body: string }

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
      `${baseURL()}/api/v1/sessions/${conversationID}/tools/${encodeURIComponent(name)}`,
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

// isRecordValue —— narrows res.json()'s unknown down to a Record (avoids an
// `as` assertion, satisfies eslint consistent-type-assertions).
function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}


// fetchVisitorDoc —— when the public landing page is behind the lockscreen,
// fetches a cited document by path via corpus_read, using the visitor session
// (token + their own conversation). ACL is evaluated by the backend by role:
// granted → full text back, not granted / no session → null (stays locked).
export async function fetchVisitorDoc(
  conversationID: string, sessionToken: string, path: string,
): Promise<VisitorDoc | null> {
  try {
    const res = await fetch(
      `${baseURL()}/api/v1/sessions/${conversationID}/tools/corpus_read`,
      {
        // QUERY (RFC 10008): corpus_read is a safe/idempotent read; same-origin,
        // no preflight.
        method: 'QUERY',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ path }),
      },
    );
    if (!res.ok) return null;
    const parsed = VisitorDocSchema.safeParse(await res.json());
    return parsed.success && parsed.data.ok && parsed.data.result.body !== ''
      ? { title: parsed.data.result.title, body: parsed.data.result.body }
      : null;
  } catch {
    return null;
  }
}

// fetchWikiTree —— one layer of GET /api/v1/wiki-tree[?parent=ID]. A non-empty
// token carries Bearer (uses the code's role scope); otherwise anonymous
// (published only). ACL is evaluated by the backend — entries outside scope
// aren't returned at all. Bad response / network failure → []. Logic here is
// thin, the component just renders.
export async function fetchWikiTree(parentID: string, token: string): Promise<TreeNode[]> {
  try {
    const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`${baseURL()}/api/v1/wiki-tree${qs}`, { headers, cache: 'no-store' });
    if (!res.ok) return [];
    const parsed = TreeResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.nodes : [];
  } catch {
    return [];
  }
}

// WritingTreeNode wire —— a backend writing-tree node (slug + locked). When
// mapped into the neutral TreeNode, slug is loaded into path (the reader
// navigates /writings/<slug>), reusing LazyTree.
const WritingTreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  has_children: z.boolean(),
  locked: z.boolean(),
});
const WritingTreeResponseSchema = z.object({ nodes: z.array(WritingTreeNodeSchema) });
const WritingTreeContextWireSchema = z.object({
  ancestors: z.array(WritingTreeNodeSchema),
  children: z.array(WritingTreeNodeSchema),
});

// mapWritingNode —— backend writing node (slug) → neutral TreeNode (slug
// loaded into path).
function mapWritingNode(n: z.infer<typeof WritingTreeNodeSchema>): TreeNode {
  return { id: n.id, title: n.title, path: n.slug, has_children: n.has_children, locked: n.locked };
}

// fetchWritingTree —— one layer of GET /api/v1/writing-tree[?parent=ID].
// public (published goes into the tree, private is marked locked). Bad
// response → [].
export async function fetchWritingTree(parentID: string): Promise<TreeNode[]> {
  try {
    const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
    const res = await fetch(`${baseURL()}/api/v1/writing-tree${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const parsed = WritingTreeResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.nodes.map(mapWritingNode) : [];
  } catch {
    return [];
  }
}

// fetchWritingContext —— GET /api/v1/writing-tree/context?slug=... — the
// article page's breadcrumb ancestor chain + sub-rail children. SSR public,
// bad response → empty context.
export async function fetchWritingContext(slug: string): Promise<TreeContext> {
  try {
    const res = await fetch(
      `${baseURL()}/api/v1/writing-tree/context?slug=${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return EMPTY_TREE_CONTEXT;
    const parsed = WritingTreeContextWireSchema.safeParse(await res.json());
    if (!parsed.success) return EMPTY_TREE_CONTEXT;
    return {
      ancestors: parsed.data.ancestors.map(mapWritingNode),
      children: parsed.data.children.map(mapWritingNode),
    };
  } catch {
    return EMPTY_TREE_CONTEXT;
  }
}

// fetchWikiContext —— GET /api/v1/wiki-tree/context?path=... — the breadcrumb
// ancestor chain + sub-rail children. A non-empty token carries Bearer (uses
// the code's role scope, sees the visitor's own gated children/ancestors); SSR
// with no token → anonymous (published only). Bad response → empty context.
// F-L-13: the reader client fetches again with the stored session token,
// upgrading SSR's anonymous children to the visitor's scope.
export async function fetchWikiContext(path: string, token = ''): Promise<TreeContext> {
  try {
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(
      `${baseURL()}/api/v1/wiki-tree/context?path=${encodeURIComponent(path)}`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return EMPTY_TREE_CONTEXT;
    const parsed = TreeContextSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : EMPTY_TREE_CONTEXT;
  } catch {
    return EMPTY_TREE_CONTEXT;
  }
}

// WikiTreeStats —— sidebar-footer counts (total / roots / non-public).
const WikiTreeStatsSchema = z.object({
  entries: z.number(),
  roots: z.number(),
  gated: z.number(),
});
export type WikiTreeStats = z.infer<typeof WikiTreeStatsSchema>;

const EMPTY_WIKI_STATS: WikiTreeStats = { entries: 0, roots: 0, gated: 0 };

// fetchWikiTreeStats —— GET /api/v1/wiki-tree/stats — sidebar-footer counts.
// Bad response → all 0. A non-empty token carries Bearer: the gated count says
// how many are closed **to this visitor**, behind the same gate as wiki-tree
// (F-L-14).
export async function fetchWikiTreeStats(token = ''): Promise<WikiTreeStats> {
  try {
    const headers: Record<string, string> = token === ''
      ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`${baseURL()}/api/v1/wiki-tree/stats`, { headers, cache: 'no-store' });
    if (!res.ok) return EMPTY_WIKI_STATS;
    const parsed = WikiTreeStatsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : EMPTY_WIKI_STATS;
  } catch {
    return EMPTY_WIKI_STATS;
  }
}

export const issuePublicSession = () => client().issueSession({ mode: 'public' });
export const issueCodeSession = (input: IssueCodeSessionInput) =>
  client().issueSession({ ...input, mode: 'code' });
export const issueBYOAISession = (input: IssueBYOAISessionInput) =>
  client().issueSession({ ...input, mode: 'byoai' });

// streamChatMessage —— **system is required**: goes through /agent/turn, an
// empty system means the model never gets the fragment + persona (F-O-2).
// Each session composes it once first via composeChatSystem.
export function streamChatMessage(
  conversationID: string, sessionToken: string, content: string,
  system: string, byoai?: BYOAIHeaders,
): AsyncGenerator<SSEEvent, void, unknown> {
  return client().streamMessage(conversationID, sessionToken, content, system, byoai);
}

// composeChatSystem —— this session's system prompt (fragment + persona).
export const composeChatSystem = (s: PublicSessionResponse): Promise<string> =>
  client().composeSystem(s);

// Some callers still need IssueSessionInput directly (custom-page uses it in
// sdk-react's useChatSession), re-exported for compatibility.
export type { IssueSessionInput };

// ─── posts (blog) ────────────────────────────────────────────────────
// The SDK doesn't cover posts yet; this goes straight to raw fetch. Move it
// over when the SDK is extended later, to keep the dogfooding intact.
//
// body_md is raw GitHub-flavored markdown; the render side uses react-markdown
// + remark-gfm to render it directly. No intermediate block structure is stored.

import { WritingViewSchema } from '@/lib/api/public-schemas';

export type { BacklinkRef, WritingView } from '@/lib/api/public-schemas';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

async function fetchJSONSchema<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(baseURL() + path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return safeJson(res, schema);
}

const WritingsPageSchema = z.object({
  writings: z.array(WritingViewSchema), next_cursor: z.string().optional(),
});

export const fetchWritingsPage = (cursor?: string, limit?: number) => {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const suffix = qs.toString() ? '?' + qs.toString() : '';
  return fetchJSONSchema('/api/v1/writings' + suffix, WritingsPageSchema);
};

// lang —— `?lang=zh`. For a multilingual article, **the server** picks the
// side: crawlers and agents fetch actual content, not both copies sent down
// with one hidden via CSS. Empty string = the param isn't sent, the backend
// decides by this request's identity language.
export const fetchWriting = (slug: string, lang = '') =>
  fetchJSONSchema(
    '/api/v1/writings/' + encodeURIComponent(slug)
      + (lang === '' ? '' : `?lang=${encodeURIComponent(lang)}`),
    WritingViewSchema,
  );
