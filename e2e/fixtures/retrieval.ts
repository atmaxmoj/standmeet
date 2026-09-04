// retrieval.ts —— fixture dedicated to the crawl-face (retrieval): visitor calls to
// corpus_search / corpus_links + owner write helpers (update/delete/publish). Shared
// by the 5 retrieval-* specs.
//
// Contract (defined while RED, the implementation must satisfy it):
//   • corpus_search {query}  → result: SearchHit[]      (Meili lexical, after ACL)
//   • corpus_links  {path}   → result: { outgoing: SearchHit[], backlinks: SearchHit[] }  (1 hop, kept separate)

import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface ToolResp<T = unknown> {
  ok: boolean;
  reason?: string;
  result?: T;
}

export interface SearchHit {
  id: string;
  path: string;
  title: string;
  genre: string;
}

export interface LinksResult {
  outgoing: SearchHit[];
  backlinks: SearchHit[];
}

// visitorTool —— hits the per-tool endpoint POST /sessions/{conv}/tools/{tool} (Bearer session_token).
async function visitorTool<T>(
  request: APIRequestContext, sess: VisitorSession, tool: string, args: unknown,
): Promise<{ status: number; body: ToolResp<T> }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args as object },
  );
  return { status: res.status(), body: await res.json() as ToolResp<T> };
}

// SearchResult —— the corpus_search receipt. hits is always present; note only appears
// when empty-handed, to make clear "empty does not mean nothing exists — this index
// depends on tokenization" (F-S-2).
export interface SearchResult {
  hits: SearchHit[];
  note?: string;
}

// searchResult —— the full receipt (use it when asserting on note).
export async function searchResult(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<SearchResult> {
  const { body } = await visitorTool<SearchResult>(request, sess, 'corpus_search', { query });
  return body.result ?? { hits: [] };
}

// search —— just the hits array. This is what the vast majority of specs care about,
// so when the wire changes shape they don't have to change a single line.
export async function search(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<SearchHit[]> {
  return (await searchResult(request, sess, query)).hits ?? [];
}

// searchTitles —— the set of hit titles (for assertions).
export async function searchTitles(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<string[]> {
  return (await search(request, sess, query)).map((h) => h.title);
}

// GrepHit —— one corpus_grep hit: which note + the matching lines + the total matches in it.
export interface GrepHit {
  path: string;
  title: string;
  genre: string;
  lines: { line: number; text: string }[];
  matches: number;
}

// grep —— corpus_grep. result has two shapes: a hits array, or `{error}` (a broken pattern ——
// that is one of this tool's **normal answers**, on the same path as corpus_read's "not found":
// a sentence the agent can read, not a 500). So the return type is a union, and the caller
// discriminates.
export type GrepResult = GrepHit[] | { error: string };

export async function grep(
  request: APIRequestContext, sess: VisitorSession,
  pattern: string, opts: { fixed?: boolean; case_sensitive?: boolean } = {},
): Promise<{ status: number; body: ToolResp<GrepResult> }> {
  return visitorTool<GrepResult>(request, sess, 'corpus_grep', { pattern, ...opts });
}

// grepHits —— the hits array (an error answer → empty array).
export function grepHits(body: ToolResp<GrepResult>): GrepHit[] {
  return Array.isArray(body.result) ? body.result : [];
}

// grepError —— that error sentence (not an error answer → empty string).
export function grepError(body: ToolResp<GrepResult>): string {
  return Array.isArray(body.result) ? '' : body.result?.error ?? '';
}

// grepTitles —— the set of hit titles (for assertions).
export async function grepTitles(
  request: APIRequestContext, sess: VisitorSession,
  pattern: string, opts: { fixed?: boolean } = {},
): Promise<string[]> {
  const { body } = await grep(request, sess, pattern, opts);
  return grepHits(body).map((h) => h.title);
}

// links —— corpus_links; returns {status, body} (check status/reason when asserting not-found/denied).
export async function links(
  request: APIRequestContext, sess: VisitorSession, path: string,
): Promise<{ status: number; body: ToolResp<LinksResult> }> {
  return visitorTool<LinksResult>(request, sess, 'corpus_links', { path });
}

// ── owner write operations (via MCP owner tools; apiToken + sid, see initMCP) ──

export async function updateWiki(
  request: APIRequestContext, apiToken: string, sid: string,
  wikiID: string, fields: { title: string; body: string },
): Promise<unknown> {
  return callTool(request, apiToken, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: fields.title, body: fields.body, tags: [],
  });
}

export async function deleteWiki(
  request: APIRequestContext, apiToken: string, sid: string, wikiID: string,
): Promise<unknown> {
  return callTool(request, apiToken, sid, 'corpus.delete', { genre: 'wiki', id: wikiID });
}

// promoteWikiToOutput —— wiki → output promotion (the write path for a genre migration).
export async function promoteWikiToOutput(
  request: APIRequestContext, apiToken: string, sid: string,
  wikiID: string, fields: { title: string; body: string },
): Promise<unknown> {
  return callTool(request, apiToken, sid, 'corpus.promote', {
    genre: 'wiki', id: wikiID, title: fields.title, body: fields.body,
  });
}

// setPublished —— per-entry publish toggle (PATCH /api/admin/corpus/wiki/{id}/seo). unpublish → invisible to visitors.
export async function setPublished(
  request: APIRequestContext, csrf: string, wikiID: string, published: boolean,
): Promise<void> {
  const res = await request.patch(`${BACKEND}/api/admin/corpus/wiki/${wikiID}/seo`, {
    headers: { 'X-Csrftoken': csrf },
    data: { excerpt: '', published },
  });
  if (res.status() >= 300) {
    throw new Error(`setPublished failed: ${res.status()} ${await res.text()}`);
  }
}

// RetrievalOwner —— the shared owner + credentials + two codes (full-glob / narrow-glob) after setup.
// request is a **logged-in admin context** (with session cookie), kept for later admin writes (setPublished) +
// owner MCP writes (seedWiki/update/delete use an apiToken Bearer, any context works). The spec disposes it in afterAll.
export interface RetrievalOwner {
  request: APIRequestContext;
  handle: string;
  email: string;
  password: string;
  csrf: string;
  apiToken: string;
  sid: string;
  fullCode: string;
  narrowCode: string;
}

// setupRetrievalOwner —— claim owner + create the full (wiki://** output://**) and narrow (wiki://projects/**)
// role/code pair + an owner MCP write session. Each spec seeds its own notes.
export async function setupRetrievalOwner(
  playwright: Playwright, handle: string,
): Promise<RetrievalOwner> {
  resetInstance();
  const request = await playwright.request.newContext();
  const email = `${handle}@example.com`;
  const password = 'correct-horse-battery-staple';
  await claim(request, findSetupToken(), { email, password, handle, fullName: `${handle} Owner` });
  const { csrf } = await loginAPI(request, email, password);

  const full = await createRole(request, csrf, {
    name: 'full', description: 'all corpus', corpus_uris: ['wiki://**', 'output://**'],
  });
  const fullCode = `${handle.toUpperCase()}-FULL`;
  await createCode(request, csrf, { code: fullCode, label: 'full', assumed_role_id: full.id });

  const narrow = await createRole(request, csrf, {
    name: 'narrow', description: 'projects only', corpus_uris: ['wiki://projects/**'],
  });
  const narrowCode = `${handle.toUpperCase()}-NARROW`;
  await createCode(request, csrf, { code: narrowCode, label: 'narrow', assumed_role_id: narrow.id });

  const apiToken = await createAPIToken(request, csrf, `${handle}-seed`);
  const sid = await initMCP(request, apiToken);
  return { request, handle, email, password, csrf, apiToken, sid, fullCode, narrowCode };
}
