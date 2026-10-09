// posts.ts —— the shared fixture for the posts specs (docs/design/posts-tests.md).
//
// Contract (defined while RED; the implementation must satisfy it):
//   Owner (MCP, same verbs as every genre, genre "post"):
//     corpus.create {genre:'post', body, visibility?, visible_role_ids?} → PostView
//     corpus.update {genre:'post', id, body?, visibility?, visible_role_ids?} → PostView
//     corpus.delete {genre:'post', id} → trash;  corpus.get {genre:'post', id} → PostView
//     corpus.list {genre:'post', visibility?, q?, cursor?, limit?} → {items, next_cursor, total}
//     corpus.search {genre:'post', query} → {items}
//   Readers:
//     GET /api/v1/posts?cursor=&limit= [Authorization: Bearer <visitor session token>]
//       → {items: PublicPost[], next_cursor, total}   — what the caller may see; no session → public
//     visitor corpus tools address a post as path `posts/<id>`, genre `post`
//   Events: post.created / post.updated / post.deleted, data {post_id, visibility} — never a body.
//
// Markers: every seeded post carries a unique token, and "a response contains a post" means "the
// response text contains its token" — searched over the whole response, never a parsed field.

import type { APIRequestContext, Playwright } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole, getRoleByName } from '@/fixtures/roles';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Visibility = 'private' | 'public' | 'roles';

export interface PostView {
  id: string;
  body: string;
  visibility: Visibility;
  visible_role_ids: string[];
  created_at: string;
  updated_at: string;
}

interface PublicPost {
  id: string;
  body: string;
  created_at: string;
  edited: boolean;
}

interface Page<T> { items: T[]; next_cursor?: string; total?: number }

// ── owner ─────────────────────────────────────────────────────────────────────────────────────

export interface PostsOwner {
  request: APIRequestContext;   // logged-in admin context
  csrf: string;
  apiToken: string;
  sid: string;
  handle: string;
  roles: { hiring: string; invited: string; wide: string };
  codes: { hiring: string; invited: string; wide: string; hiringDenyAll: string };
}

// setupPostsOwner —— claim + the roles and codes the matrix needs: the builtin `hiring` and
// `invited` roles, a `wide` role whose corpus globs cover every genre (globs never grant posts),
// and a hiring code that denies all corpus (code denials never narrow posts).
export async function setupPostsOwner(playwright: Playwright, handle: string): Promise<PostsOwner> {
  resetInstance();
  const request = await playwright.request.newContext();
  const email = `${handle}@example.com`;
  const password = 'correct-horse-battery-staple';
  await claim(request, findSetupToken(), { email, password, handle, fullName: `${handle} Owner` });
  const { csrf } = await loginAPI(request, email, password);
  const hiring = (await getRoleByName(request, 'hiring')).id;
  const invited = (await getRoleByName(request, 'invited')).id;
  const wide = (await createRole(request, csrf, {
    name: 'wide', description: 'every corpus genre',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'],
  })).id;
  const up = handle.toUpperCase();
  const codes = {
    hiring: `${up}-HIR`, invited: `${up}-INV`, wide: `${up}-WIDE`, hiringDenyAll: `${up}-HIRDENY`,
  };
  await createCode(request, csrf, { code: codes.hiring, label: 'hiring', assumed_role_id: hiring });
  await createCode(request, csrf, { code: codes.invited, label: 'invited', assumed_role_id: invited });
  await createCode(request, csrf, { code: codes.wide, label: 'wide', assumed_role_id: wide });
  const deny = await createCode(request, csrf, {
    code: codes.hiringDenyAll, label: 'hiring, corpus denied', assumed_role_id: hiring,
  });
  const apiToken = await createAPIToken(request, csrf, `${handle}-posts`);
  const sid = await initMCP(request, apiToken);
  await callTool(request, apiToken, sid, 'codes.set_corpus_denials', {
    code_id: deny.id, uris: ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'],
  });
  return {
    request, csrf, apiToken, sid, handle,
    roles: { hiring, invited, wide }, codes,
  };
}

interface NewPost { body: string; visibility?: Visibility; visible_role_ids?: string[] }

// The other owner verbs (update / delete / get / refusals) are added here by the spec that first
// uses them — knip refuses an export nothing reads.
function createPost(o: PostsOwner, p: NewPost): Promise<PostView> {
  return callTool<PostView>(o.request, o.apiToken, o.sid, 'corpus.create', { genre: 'post', ...p });
}

export async function listAllPosts(o: PostsOwner, filter: Record<string, unknown> = {}): Promise<PostView[]> {
  const out: PostView[] = [];
  let cursor: string | undefined;
  do {
    const page = await callTool<Page<PostView>>(o.request, o.apiToken, o.sid, 'corpus.list',
      { genre: 'post', limit: 200, ...filter, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

// ── markers + the matrix seed ─────────────────────────────────────────────────────────────────

function marker(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export interface Seeded {
  priv: PostView; pub: PostView; hir: PostView; hirInv: PostView;
  m: { priv: string; pub: string; hir: string; hirInv: string };
}

// seedMatrix —— the four posts of the visibility matrix (posts-tests.md § A), each with a marker.
export async function seedMatrix(o: PostsOwner): Promise<Seeded> {
  const m = { priv: marker('PRIV'), pub: marker('PUB'), hir: marker('HIR'), hirInv: marker('HIRINV') };
  const priv = await createPost(o, { body: `A private note ${m.priv}.`, visibility: 'private' });
  const pub = await createPost(o, { body: `A public update ${m.pub}.`, visibility: 'public' });
  const hir = await createPost(o, {
    body: `For recruiters ${m.hir}.`, visibility: 'roles', visible_role_ids: [o.roles.hiring],
  });
  const hirInv = await createPost(o, {
    body: `For recruiters and invitees ${m.hirInv}.`, visibility: 'roles',
    visible_role_ids: [o.roles.hiring, o.roles.invited],
  });
  return { priv, pub, hir, hirInv, m };
}

// ── readers ───────────────────────────────────────────────────────────────────────────────────

// timelineText —— every page of GET /api/v1/posts as one raw text (markers are searched in it).
export async function timelineText(
  request: APIRequestContext, sessionToken = '',
): Promise<{ text: string; total: number; status: number }> {
  let text = '';
  let total = -1;
  let status = 0;
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const res = await request.get(`${BACKEND}/api/v1/posts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} });
    status = res.status();
    const raw = await res.text();
    text += raw;
    if (status !== 200) break;
    const body = JSON.parse(raw) as Page<PublicPost>;
    if (total < 0) total = body.total ?? -1;
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return { text, total, status };
}

// visitorToolRaw —— POST /sessions/{conv}/tools/{tool}: status + the raw body text.
export async function visitorToolRaw(
  request: APIRequestContext, sess: VisitorSession, tool: string, args: unknown,
): Promise<{ status: number; text: string }> {
  const res = await request.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args as object, timeout: 25_000 });
  return { status: res.status(), text: await res.text() };
}

// turnRaw —— one /agent/turn as the raw SSE text (answer + tool frames + citations + ghost).
export async function turnRaw(
  request: APIRequestContext, sess: VisitorSession, message: string,
): Promise<{ status: number; text: string }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: message, conversation_id: sess.conversation_id, history: [] },
    timeout: 60_000,
  });
  return { status: res.status(), text: await res.text() };
}

// has —— does a raw response contain this marker.
export function has(text: string, mark: string): boolean {
  return text.includes(mark);
}
