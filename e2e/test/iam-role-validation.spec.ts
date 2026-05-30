// iam-role-validation.spec.ts —— admin /api/admin/roles 的拒绝路径：
//   - vanilla 不可改名（403 role_builtin_immutable）
//   - vanilla 不可删（403 role_builtin_immutable）
//   - 同 owner 重 name → 409 role_name_taken
//   - prompt_id 不属于同 owner → 400 bad_request
//   - skill_ids 含非 owner 的 → 400 bad_request
//   - mcp_server_ids 含非 owner 的 → 400 bad_request
//
// 都是 backend layer 的兜底校验，UI 直接 hide 也防御不到 attacker 手写 curl，
// 所以 backend 必须挡且翻译成有意义 envelope code。
//
// 注意：admin REST 要 session cookie + X-Csrftoken；APIRequestContext 持
// cookie，dispose 后就丢。所以每个 test 自己 login（cheap，就一次 hash 验密）
// 再发请求。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole, getRoleByName } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'roleval@example.com', password: 'correct-horse-battery-staple',
  handle: 'roleval', fullName: 'Role Validation Owner',
};

const ctx: { vanillaID: string } = { vanillaID: '' };

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  const vanilla = await getRoleByName(request, 'vanilla');
  ctx.vanillaID = vanilla.id;
  await request.dispose();
});

async function authedRequest(
  newCtx: () => Promise<APIRequestContext>,
): Promise<{ request: APIRequestContext; csrf: string }> {
  const request = await newCtx();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('A.3-IAM role REST · builtin + uniqueness', () => {
  test('PUT vanilla with a different name → 403 role_builtin_immutable',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const res = await request.put(`${BACKEND}/api/admin/roles/${ctx.vanillaID}`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'not-vanilla', description: 'try to rename builtin',
          prompt_id: null, corpus_uris: [], skill_ids: [], mcp_server_ids: [],
        },
      });
      expect(res.status()).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('role_builtin_immutable');
      await request.dispose();
    });

  test('DELETE vanilla → 403 role_builtin_immutable', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.delete(`${BACKEND}/api/admin/roles/${ctx.vanillaID}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(res.status()).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('role_builtin_immutable');
    await request.dispose();
  });

  test('duplicate role name in same owner → 409 role_name_taken',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      await createRole(request, csrf, { name: 'dup-role' });
      const res = await request.post(`${BACKEND}/api/admin/roles/`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'dup-role', description: '', prompt_id: null,
          corpus_uris: [], skill_ids: [], mcp_server_ids: [],
        },
      });
      expect(res.status()).toBe(409);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('role_name_taken');
      await request.dispose();
    });
});

test.describe('A.3-IAM role REST · join ownership validation', () => {
  const BOGUS = '00000000-0000-0000-0000-000000000000';

  test('role with bogus prompt_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-prompt-role', description: '', prompt_id: BOGUS,
        corpus_uris: [], skill_ids: [], mcp_server_ids: [],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });

  test('role with bogus skill_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-skill-role', description: '', prompt_id: null,
        corpus_uris: [], skill_ids: [BOGUS], mcp_server_ids: [],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });

  test('role with bogus mcp_server_id → 400 bad_request', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.post(`${BACKEND}/api/admin/roles/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'bad-mcp-role', description: '', prompt_id: null,
        corpus_uris: [], skill_ids: [], mcp_server_ids: [BOGUS],
      },
    });
    expect(res.status()).toBe(400);
    await request.dispose();
  });
});
