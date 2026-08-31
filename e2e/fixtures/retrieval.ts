// retrieval.ts —— crawl-face(retrieval)专用 fixture:corpus_search / corpus_links 的
// visitor 调用 + owner 写操作(update/delete/publish)helper。给 5 个 retrieval-* spec 共用。
//
// 契约(RED 时定义,实现要满足):
//   • corpus_search {query}  → result: SearchHit[]      (Meili 词法,ACL 后)
//   • corpus_links  {path}   → result: { outgoing: SearchHit[], backlinks: SearchHit[] }  (1 跳,分开)

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

// visitorTool —— 走 per-tool 端点 POST /sessions/{conv}/tools/{tool}(Bearer session_token)。
async function visitorTool<T>(
  request: APIRequestContext, sess: VisitorSession, tool: string, args: unknown,
): Promise<{ status: number; body: ToolResp<T> }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args as object },
  );
  return { status: res.status(), body: await res.json() as ToolResp<T> };
}

// SearchResult —— corpus_search 的回执。hits 永远在；note 只在空手时出现，
// 说清"空不等于没有，这条索引依赖分词"（F-S-2）。
export interface SearchResult {
  hits: SearchHit[];
  note?: string;
}

// searchResult —— 整份回执（要断 note 的用它）。
export async function searchResult(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<SearchResult> {
  const { body } = await visitorTool<SearchResult>(request, sess, 'corpus_search', { query });
  return body.result ?? { hits: [] };
}

// search —— 只要命中数组。绝大多数 spec 关心的就是这个，
// 所以 wire 换形状时它们一个字都不用改。
export async function search(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<SearchHit[]> {
  return (await searchResult(request, sess, query)).hits ?? [];
}

// searchTitles —— 命中的 title 集合(断言用)。
export async function searchTitles(
  request: APIRequestContext, sess: VisitorSession, query: string,
): Promise<string[]> {
  return (await search(request, sess, query)).map((h) => h.title);
}

// GrepHit —— corpus_grep 的一条命中:哪一条笔记 + 命中的行 + 这条里的匹配总数。
export interface GrepHit {
  path: string;
  title: string;
  genre: string;
  lines: { line: number; text: string }[];
  matches: number;
}

// grep —— corpus_grep。result 有两种形状:命中数组,或者 `{error}`(模式写坏了 —— 那是这个
// 工具的一种**正常回答**,跟 corpus_read 的 "not found" 走同一条路:agent 读得懂的一句话,
// 不是 500)。所以返回类型是联合,调用方自己分。
export type GrepResult = GrepHit[] | { error: string };

export async function grep(
  request: APIRequestContext, sess: VisitorSession,
  pattern: string, opts: { fixed?: boolean; case_sensitive?: boolean } = {},
): Promise<{ status: number; body: ToolResp<GrepResult> }> {
  return visitorTool<GrepResult>(request, sess, 'corpus_grep', { pattern, ...opts });
}

// grepHits —— 命中数组(错误回答 → 空数组)。
export function grepHits(body: ToolResp<GrepResult>): GrepHit[] {
  return Array.isArray(body.result) ? body.result : [];
}

// grepError —— 那句错误(不是错误回答 → 空串)。
export function grepError(body: ToolResp<GrepResult>): string {
  return Array.isArray(body.result) ? '' : body.result?.error ?? '';
}

// grepTitles —— 命中的 title 集合(断言用)。
export async function grepTitles(
  request: APIRequestContext, sess: VisitorSession,
  pattern: string, opts: { fixed?: boolean } = {},
): Promise<string[]> {
  const { body } = await grep(request, sess, pattern, opts);
  return grepHits(body).map((h) => h.title);
}

// links —— corpus_links;返 {status, body}(要断 not-found/denied 时看 status/reason)。
export async function links(
  request: APIRequestContext, sess: VisitorSession, path: string,
): Promise<{ status: number; body: ToolResp<LinksResult> }> {
  return visitorTool<LinksResult>(request, sess, 'corpus_links', { path });
}

// ── owner 写操作(经 MCP owner tools;apiToken + sid 见 initMCP)──

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

// promoteWikiToOutput —— wiki → output 提升(genre 迁移的 write 路径)。
export async function promoteWikiToOutput(
  request: APIRequestContext, apiToken: string, sid: string,
  wikiID: string, fields: { title: string; body: string },
): Promise<unknown> {
  return callTool(request, apiToken, sid, 'corpus.promote', {
    genre: 'wiki', id: wikiID, title: fields.title, body: fields.body,
  });
}

// setPublished —— per-entry 发布开关(PATCH /api/admin/corpus/wiki/{id}/seo)。unpublish → 访客不可见。
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

// RetrievalOwner —— setup 后共用的 owner + 凭据 + 两个 code(full-glob / narrow-glob)。
// request 是**已登录的 admin context**(带 session cookie),留给后续 admin 写(setPublished)+
// owner MCP 写(seedWiki/update/delete 用 apiToken Bearer,任意 context 均可)。spec 在 afterAll dispose。
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

// setupRetrievalOwner —— claim owner + 建 full(wiki://** output://**) 与 narrow(wiki://projects/**)
// 两个 role/code + owner MCP 写会话。各 spec seed 自己的 note。
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
