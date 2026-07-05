// iam-prompt-validation.spec.ts —— admin /api/admin/prompts 的拒绝路径：
//   - publicRow 不可改名 → 403 prompt_builtin_immutable
//   - publicRow 改名以外的字段（body/desc）可改 → 200
//   - publicRow 不可删 → 403 prompt_builtin_immutable
//   - 同 owner 重 name → 409 prompt_name_taken

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'promptval@example.com', password: 'correct-horse-battery-staple',
  handle: 'promptval', fullName: 'Prompt Validation Owner',
};

interface PromptView { id: string; name: string }

const ctx: { publicID: string } = { publicID: '' };

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  const listRes = await request.get(`${BACKEND}/api/admin/prompts/`);
  const list = await listRes.json() as PromptView[];
  const publicRow = list.find((p) => p.name === 'public');
  if (!publicRow) throw new Error('public prompt not seeded');
  ctx.publicID = publicRow.id;
  await request.dispose();
});

async function authedRequest(
  newCtx: () => Promise<APIRequestContext>,
): Promise<{ request: APIRequestContext; csrf: string }> {
  const request = await newCtx();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

test.describe('A.3-IAM prompt REST · builtin immutable rename / delete', () => {
  test('PUT publicRow with a different name → 403 prompt_builtin_immutable',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const res = await request.put(`${BACKEND}/api/admin/prompts/${ctx.publicID}`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'not-public', description: 'try rename builtin',
          body: 'updated body is fine, but rename is not',
        },
      });
      expect(res.status()).toBe(403);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('prompt_builtin_immutable');
      await request.dispose();
    });

  test('PUT publicRow with SAME name but new body → 200 (only rename is blocked)',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const res = await request.put(`${BACKEND}/api/admin/prompts/${ctx.publicID}`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: 'public', description: 'unchanged',
          body: 'You are a freshly customized publicRow.',
        },
      });
      expect(res.status()).toBe(200);
      await request.dispose();
    });

  test('DELETE publicRow → 403 prompt_builtin_immutable', async ({ playwright }) => {
    const { request, csrf } = await authedRequest(() => playwright.request.newContext());
    const res = await request.delete(`${BACKEND}/api/admin/prompts/${ctx.publicID}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(res.status()).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('prompt_builtin_immutable');
    await request.dispose();
  });
});

test.describe('A.3-IAM prompt REST · name uniqueness', () => {
  test('duplicate prompt name in same owner → 409 prompt_name_taken',
    async ({ playwright }) => {
      const { request, csrf } = await authedRequest(() => playwright.request.newContext());
      const first = await request.post(`${BACKEND}/api/admin/prompts/`, {
        headers: { 'X-Csrftoken': csrf },
        data: { name: 'dup-prompt', description: '', body: 'a' },
      });
      expect(first.status()).toBe(201);
      const second = await request.post(`${BACKEND}/api/admin/prompts/`, {
        headers: { 'X-Csrftoken': csrf },
        data: { name: 'dup-prompt', description: '', body: 'b' },
      });
      expect(second.status()).toBe(409);
      const body = await second.json() as { error: { code: string } };
      expect(body.error.code).toBe('prompt_name_taken');
      await request.dispose();
    });
});
