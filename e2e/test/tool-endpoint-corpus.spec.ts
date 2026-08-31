// tool-endpoint-corpus.spec.ts —— visitor 通过 per-tool HTTP 端点
// 直调 corpus_search / corpus_read / corpus_list 三个 tool。前端
// pi-agent-core 的 ToolDispatcher port 实现走的就是这个 endpoint，
// 让 per-tool UI throbber 可见 (旧 SSE 流里全程黑盒)。
//
// 不变量：
//   - URL: POST /api/v1/sessions/{conv_id}/tools/{tool_name}
//   - Auth: Bearer session_token
//   - Happy: 返 {ok:true, result, capability_state}
//   - 异常 capability disabled: 404 + {ok:false, reason:"capability_not_enabled"}
//   - 异常 bad token: 401
//   - 异常 invalid args: 200 + tool envelope (executor 自己翻译)
//   - 不变: capability_state field 必返 (前端 zustand 同步)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'corpus-tool@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpus-tool', fullName: 'Corpus Tool Owner',
};

const CODE_FULL = 'CORPUS-FULL';
const CODE_EMPTY = 'CORPUS-EMPTY';
const CODE_NARROW = 'CORPUS-NARROW';
// 地址是树派生的:parent「projects/family」段 + leaf 的 slug(title)。
// 'Lucerna project notes' → 'lucerna-project-notes';'Family secret' →
// 'family-secret'。ACL glob wiki://projects/** 允许前者、拒后者。
const NARROW_ALLOWED_PATH = 'projects/lucerna-project-notes';
const NARROW_DENIED_PATH = 'family/family-secret';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: unknown;
  capability_state?: SessionCapability[];
}

async function setupCorpusToolOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const roleFull = await createRole(request, csrf, {
    name: 'full-corpus-role', description: 'role with corpus URIs',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE_FULL, label: 'full', assumed_role_id: roleFull.id,
  });
  const roleEmpty = await createRole(request, csrf, {
    name: 'no-corpus-role', description: 'role without corpus URIs',
    corpus_uris: [],
  });
  await createCode(request, csrf, {
    code: CODE_EMPTY, label: 'empty', assumed_role_id: roleEmpty.id,
  });
  // Narrow role: 仅允许 wiki://projects/**。seed 两条 wiki: 一条 projects 下
  // (允许)、一条 family 下 (拒)。这样可以验 ACL 拒走 result.error 而不是
  // 404 (entry 存在但越权)。
  const roleNarrow = await createRole(request, csrf, {
    name: 'narrow-corpus-role', description: 'wiki://projects/** only',
    corpus_uris: ['wiki://projects/**'],
  });
  await createCode(request, csrf, {
    code: CODE_NARROW, label: 'narrow', assumed_role_id: roleNarrow.id,
  });
  await seedNarrowWikis(request, csrf);
  await request.dispose();
}

async function seedNarrowWikis(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const apiToken = await createAPIToken(request, csrf, 'corpus-tool-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: 'Lucerna project notes', body: 'Public projects detail.',
    path: NARROW_ALLOWED_PATH,
  });
  await seedWiki(request, apiToken, sid, {
    title: 'Family secret', body: 'This is private.',
    path: NARROW_DENIED_PATH,
  });
}

async function freshSession(
  request: APIRequestContext, code: string,
): Promise<VisitorSession> {
  return issueSession(
    request, { handle: OWNER.handle, code, visitor_name: 'V' },
  );
}

async function callTool(
  request: APIRequestContext,
  sess: VisitorSession,
  toolName: string,
  args: unknown,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${toolName}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: args as object,
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

test.describe('tool endpoint · corpus_search / corpus_read / corpus_list', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupCorpusToolOwner(playwright);
  });

  test('corpus_search happy path → 200 + result array + capability_state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertCorpusSearchHappy(request);
      await request.dispose();
    });

  test('corpus_list happy path → 200 + result + capability_state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertCorpusListHappy(request);
      await request.dispose();
    });

  test('empty corpus role → corpus_search returns 200 with empty array (cap enabled=false but tool still callable)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertEmptyRoleSearchOk(request);
      await request.dispose();
    });

  test('narrow ACL: corpus_read allowed path → 200 + result.genre=wiki body',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowAllowedPath(request);
      await request.dispose();
    });

  test('narrow ACL: corpus_read DENIED path → 200 + result.error="access denied: <path>"',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowDeniedPath(request);
      await request.dispose();
    });

  // ACL must hold on SEARCH too, not just READ. read-deny above only proves you
  // can't READ an out-of-scope path; this proves SEARCH never SURFACES one — the
  // exact behaviour #157 moves from "filter after the scan" into the Search method.
  // Direct (no LLM): the prior coverage was only the LLM-driven cited-refs path.
  test('narrow ACL: corpus_search excludes entries outside role.corpus_uris (ACL on SEARCH, not just read)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertNarrowSearchExcludesDenied(request);
      await request.dispose();
    });

  test('unknown tool name → 404 + {ok:false, reason:"capability_not_enabled"}',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request, CODE_FULL);
      const { status, body } = await callTool(
        request, sess, 'no_such_tool', {},
      );
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.reason).toBe('capability_not_enabled');
      await request.dispose();
    });

  test('bad session token → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertBadTokenReturns401(request);
      await request.dispose();
    });

  test('no credentials (no bearer, no cookie) → 401',
    async ({ playwright }) => {
      const seeded = await playwright.request.newContext();
      const sess = await freshSession(seeded, CODE_FULL);
      // 用全新 context 打:无 bearer **且** 无 session cookie → 真·无凭证 → 401。
      // (seeded 那个 context 因为发过 session,jar 里有 sm_vsession cookie,会被认。)
      const anon = await playwright.request.newContext();
      await assertNoCredsReturns401(anon, sess.conversation_id);
      await seeded.dispose();
      await anon.dispose();
    });
});

async function assertCorpusSearchHappy(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_FULL);
  const { status, body } = await callTool(
    request, sess, 'corpus_search', { query: 'lucerna' },
  );
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.capability_state, 'always returns fresh cap state').toBeDefined();
  expect(Array.isArray(body.capability_state)).toBe(true);
}

async function assertCorpusListHappy(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_FULL);
  const { status, body } = await callTool(
    request, sess, 'corpus_list', {},
  );
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
}

async function assertEmptyRoleSearchOk(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_EMPTY);
  const { status, body } = await callTool(
    request, sess, 'corpus_search', { query: 'anything' },
  );
  // role 有 corpus.retrieval cap 但 enabled=false（无 corpus_uris）；
  // tool 仍暴露 (B-2 spec 设计：让 LLM 调；ACL 拒返空)。
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
}

async function assertNarrowAllowedPath(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);
  const { status, body } = await callTool(
    request, sess, 'corpus_read', { path: NARROW_ALLOWED_PATH },
  );
  expect(status).toBe(200);
  const result = body.result as { genre?: string; body?: string; error?: string };
  expect(result.error, 'no ACL error for allowed path').toBeUndefined();
  expect(result.genre).toBe('wiki');
  expect(result.body).toContain('Public projects detail');
}

async function assertNarrowDeniedPath(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);
  const { status, body } = await callTool(
    request, sess, 'corpus_read', { path: NARROW_DENIED_PATH },
  );
  // endpoint envelope 永远 ok=true (executor 跑通)；越权信号在 tool
  // 返的 JSON 里 (result.error)，跟 plan 决策一致 (tool envelope
  // 而非 HTTP 403)。
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  const result = body.result as { error?: string };
  expect(result.error, 'tool envelope carries access denied').toContain('access denied');
  expect(result.error).toContain(NARROW_DENIED_PATH);
}

async function assertNarrowSearchExcludesDenied(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_NARROW);

  // a query that WOULD match the out-of-scope 'Family secret' (family/**, not granted)
  const denied = await callTool(request, sess, 'corpus_search', { query: 'secret' });
  expect(denied.status).toBe(200);
  expect(denied.body.ok).toBe(true);
  // 回执是 {hits, note?} —— note 只在空手时出现（F-S-2：空不等于没有）。
  const deniedRows = searchHitsOf(denied.body.result);
  expect(deniedRows.map((r) => r.path),
    'corpus_search must not surface a path outside role.corpus_uris').not.toContain(NARROW_DENIED_PATH);
  expect(deniedRows.map((r) => r.title),
    'corpus_search must not surface the denied entry').not.toContain('Family secret');

  // sanity: the in-scope projects entry IS searchable (so the exclusion isn't "search returns nothing")
  const allowed = await callTool(request, sess, 'corpus_search', { query: 'lucerna' });
  const allowedRows = searchHitsOf(allowed.body.result);
  expect(allowedRows.map((r) => r.path),
    'in-scope projects entry must still be searchable').toContain(NARROW_ALLOWED_PATH);
}

async function assertBadTokenReturns401(request: APIRequestContext): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/00000000-0000-0000-0000-000000000000/tools/corpus_search`,
    {
      headers: { Authorization: 'Bearer smv_bogus' },
      data: { query: 'x' },
    },
  );
  expect(res.status()).toBe(401);
}

async function assertNoCredsReturns401(
  request: APIRequestContext, conversationID: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${conversationID}/tools/corpus_search`,
    { data: { query: 'x' } },
  );
  expect(res.status()).toBe(401);
}

// searchHitsOf —— corpus_search 回执里的命中数组。
// 这条 spec 直接打 tool 端点(它验的就是端点本身)，所以自己解一层壳。
function searchHitsOf(result: unknown): Array<{ path?: string; title?: string }> {
  const r = result as { hits?: Array<{ path?: string; title?: string }> } | undefined;
  return r?.hits ?? [];
}
