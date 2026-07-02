// per-code-prompt.spec.ts —— #104 每张 access code 自带一份集中管理的 prompt。
//
// 一张挂了 prompt_id 的 code：访客用它起 session → system_prompt_persona 在 role persona 之后
// **叠加**该 prompt 的 body。没挂 prompt 的 code：persona 逐字不含它（隔离 + 守 prompt-hash）。
// prompt 集中管理（引 prompts 库），跟 role.prompt_id 同款；这里走 session-start 响应里暴露的
// system_prompt_persona 做确定性断言，不依赖 LLM 输出。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createPrompt } from '@/fixtures/prompts';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'per-code-prompt@example.com', password: 'correct-horse-battery-staple',
  handle: 'per-code-prompt', fullName: 'Per Code Prompt Owner',
};

const CODE_WITH = 'PCP-WITH';
const CODE_WITHOUT = 'PCP-WITHOUT';
// distinctive marker unlikely to appear anywhere else in the persona.
const CODE_PROMPT_BODY = 'PERCODE-MARKER-9137: answer only in haiku for this code.';

async function setupOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'greeter', description: 'plain role', corpus_uris: ['wiki://**'],
  });
  const prompt = await createPrompt(request, csrf, {
    name: 'haiku-code', description: 'per-code persona', body: CODE_PROMPT_BODY,
  });
  await createCode(request, csrf, {
    code: CODE_WITH, label: 'with-prompt', assumed_role_id: role.id, prompt_id: prompt.id,
  });
  await createCode(request, csrf, {
    code: CODE_WITHOUT, label: 'no-prompt', assumed_role_id: role.id,
  });
  await request.dispose();
}

test.describe('per-code prompt · #104 code-owned persona fragment', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupOwner(playwright);
  });

  test('code with prompt_id → session persona includes the code prompt body',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, code: CODE_WITH, visitor_name: 'V' },
      );
      expect(sess.system_prompt_persona ?? '',
        'persona must carry the per-code prompt body').toContain(CODE_PROMPT_BODY);
      await request.dispose();
    });

  test('code without prompt_id → persona omits the marker (isolation + hash-preserving)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, code: CODE_WITHOUT, visitor_name: 'V' },
      );
      expect(sess.system_prompt_persona ?? '',
        'a code with no prompt must not leak another code prompt').not.toContain(CODE_PROMPT_BODY);
      await request.dispose();
    });

  test('created code echoes prompt_id back in its view',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const listRes = await request.get(
        `${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/admin/codes`,
        { headers: { 'X-Csrftoken': csrf } },
      );
      expect(listRes.status()).toBe(200);
      const codes = await listRes.json() as Array<{ code: string; prompt_id?: string | null }>;
      const withCode = codes.find((c) => c.code === CODE_WITH);
      const withoutCode = codes.find((c) => c.code === CODE_WITHOUT);
      expect(withCode?.prompt_id, 'code-with echoes a prompt_id').toBeTruthy();
      expect(withoutCode?.prompt_id ?? null, 'code-without has null prompt_id').toBeNull();
      await request.dispose();
    });
});
