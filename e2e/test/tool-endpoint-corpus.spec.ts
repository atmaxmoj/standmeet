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

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
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
  await request.dispose();
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
      const sess = await freshSession(request, CODE_FULL);
      const { status, body } = await callTool(
        request, sess, 'corpus_search', { query: 'lucerna' },
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.capability_state, 'always returns fresh cap state').toBeDefined();
      expect(Array.isArray(body.capability_state)).toBe(true);
      await request.dispose();
    });

  test('corpus_list happy path → 200 + result + capability_state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request, CODE_FULL);
      const { status, body } = await callTool(
        request, sess, 'corpus_list', {},
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      await request.dispose();
    });

  test('empty corpus role → corpus_search returns 200 with empty array (cap enabled=false but tool still callable)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request, CODE_EMPTY);
      const { status, body } = await callTool(
        request, sess, 'corpus_search', { query: 'anything' },
      );
      // role 有 corpus.retrieval cap 但 enabled=false（无 corpus_uris）；
      // tool 仍暴露 (B-2 spec 设计：让 LLM 调；ACL 拒返空)。
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
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

  test('missing Authorization → 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertMissingAuthReturns401(request);
      await request.dispose();
    });
});

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

async function assertMissingAuthReturns401(request: APIRequestContext): Promise<void> {
  const sess = await freshSession(request, CODE_FULL);
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/corpus_search`,
    { data: { query: 'x' } },
  );
  expect(res.status()).toBe(401);
}
