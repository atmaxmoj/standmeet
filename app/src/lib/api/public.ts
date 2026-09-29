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
import type { StandMeetClient } from '@standmeet/sdk-core';

export type {
  BYOAIHeaders,
  PublicOwnerView,
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

// ssrFetch —— the app's OWN server-side fetches to the backend must not be counted as visitor
// traffic. The traffic monitor observes the public API routes; a server-rendered reader page fetches
// those same routes over the container network to render, so without this the app rendering a page
// counts as a visitor reading it (a phantom row with no browser, and every read doubled). Tag each
// SSR fetch so the monitor skips it — the visitor's OWN browser fetch, which the reader page also
// makes, is what actually counts. In the browser (window defined) this is a no-op: a real visitor.
export const SSR_INTERNAL_HEADER = 'X-Standmeet-SSR-Internal';
const ssrFetch: typeof fetch = (input, init) => {
  if (typeof window !== 'undefined') return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set(SSR_INTERNAL_HEADER, '1');
  return fetch(input, { ...init, headers });
};

function client(): StandMeetClient {
  return createClient({ baseURL: baseURL(), fetchImpl: ssrFetch });
}

// Issuing a session, reading a conversation back and calling a card's tool are the chat's own
// calls: they live with the chat, in @standmeet/sdk (src/chat/api.ts).

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
  greeting: z.string(), // '' = the role set none; the picker renders its translated default
  handle: z.string(),
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

// VisitorDoc —— the full text of a cited document, fetched via corpus_read
// with a visitor session for the lockscreen page.
const VisitorDocSchema = z.object({
  ok: z.boolean(),
  result: z.object({ body: z.string(), title: z.string() }),
});
export interface VisitorDoc { title: string; body: string }


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
  const res = await ssrFetch(baseURL() + path, { cache: 'no-store' });
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
