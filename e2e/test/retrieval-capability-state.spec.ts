// retrieval-capability-state.spec.ts —— Phase B-2 契约：corpus.retrieval
// capability 出现在 visitor-capabilities 端点，且 enabled gating 走
// RoleSnapshot.CorpusURIs（非空 = enabled=true，空 = enabled=false 但仍
// 出现以渲降级提示）。
//
// 业务故事：
//   alice 建 role R1 corpus_uris=['wiki://**', 'output://**', 'writing://**']，
//   发码 CORPUS-001 → visitor 颁发 session V1，/visitor-capabilities 必返：
//     - capabilities[?].id=='corpus.retrieval' enabled=true
//     - tool_specs 含 corpus_search / corpus_read / corpus_list 三项
//   alice 建 role R0 corpus_uris=[]（空 list），发码 EMPTY-001 → visitor V2：
//     - capabilities[?].id=='corpus.retrieval' enabled=false
//     - tool_specs 仍含三项（spec 永远暴露，ACL 拦由内部）
//
// 既有 retrieval 行为回归靠 visitor-chat-cites-output / hidden-source /
// raw-deny / freeze 等 spec 兜底；这里只验 B-2 引入的 capability map 契约。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'retrieval@example.com', password: 'correct-horse-battery-staple',
  handle: 'retrieval', fullName: 'Retrieval Owner',
};

const FULL_CODE = 'CORPUS-001';
const EMPTY_CODE = 'EMPTY-001';

interface VisitorCap { id: string; enabled: boolean }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
}

test.describe('Phase B-2 RetrievalCapability state contract', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await seedRolesAndCodes(request);
    await request.dispose();
  });

  test('role with corpus URIs → corpus.retrieval enabled + 3 tool specs',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: FULL_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const corpusCap = body.capabilities.find((c) => c.id === 'corpus.retrieval');
      expect(corpusCap, 'corpus.retrieval must appear').toBeDefined();
      expect(corpusCap?.enabled).toBe(true);
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames).toContain('corpus_search');
      expect(toolNames).toContain('corpus_read');
      expect(toolNames).toContain('corpus_list');
      await request.dispose();
    });

  test('role with empty corpus_uris → corpus.retrieval enabled=false but visible',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: EMPTY_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const corpusCap = body.capabilities.find((c) => c.id === 'corpus.retrieval');
      expect(corpusCap, 'corpus.retrieval must still appear').toBeDefined();
      expect(corpusCap?.enabled).toBe(false);
      // tool_specs 仍暴露 —— LLM 还是能调，被内部 ACL 拒（snapshot.AllowsCorpus
      // 对空 uris 永远返 false）；前端用 enabled=false 渲 "no corpus access" 提示。
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames).toContain('corpus_search');
      expect(toolNames).toContain('corpus_read');
      expect(toolNames).toContain('corpus_list');
      await request.dispose();
    });

  test('system_prompt_hash differs between full vs empty corpus roles',
    async ({ playwright }) => {
      // 两 role 的 RoleSnapshot 不同（PromptBody 一致 = 空，但 corpus_uris
      // 不同应影响 retrieval fragment → 影响 hash）。即使 PromptBody 都空，
      // capability state 不一样也应让 hash 走开。
      const request = await playwright.request.newContext();
      const sessFull = await issueSession(request, {
        handle: OWNER.handle, code: FULL_CODE, visitor_name: 'A',
      });
      const sessEmpty = await issueSession(request, {
        handle: OWNER.handle, code: EMPTY_CODE, visitor_name: 'B',
      });
      const full = await fetchVisitorCapabilities(request, sessFull.session_token);
      const empty = await fetchVisitorCapabilities(request, sessEmpty.session_token);
      expect(full.system_prompt_hash).not.toBe(empty.system_prompt_hash);
      await request.dispose();
    });
});

async function seedRolesAndCodes(request: APIRequestContext): Promise<void> {
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const full = await createRole(request, csrf, {
    name: 'full-corpus',
    description: 'all genres',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
  });
  const empty = await createRole(request, csrf, {
    name: 'no-corpus',
    description: 'no genres',
    corpus_uris: [],
  });
  await createCode(request, csrf, {
    code: FULL_CODE, label: 'full corpus', assumed_role_id: full.id,
  });
  await createCode(request, csrf, {
    code: EMPTY_CODE, label: 'empty corpus', assumed_role_id: empty.id,
  });
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
