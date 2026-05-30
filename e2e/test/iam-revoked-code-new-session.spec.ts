// iam-revoked-code-new-session.spec.ts —— revoke 后 issue 一**新** session 应被拒。
//
// iam-revoke-blocks-next-turn.spec 测的是同一 session 内 next turn 的拒绝；
// 这里补：revoke 后访客新发 session（持同一明文 code）也拒。两条加起来 cover
// "code revoked 之后访客的所有入口"。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSessionStatus } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'revoke-new@example.com', password: 'correct-horse-battery-staple',
  handle: 'revokenew', fullName: 'Revoke New Session Owner',
};

const CODE = 'REVOKE-NEW-001';

test.describe('A.3-IAM revoked code blocks new session issue', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'revoke-new-spec' });
    await revokeCodeByName(request, csrf, CODE);
    await request.dispose();
  });

  test('issue session under revoked code returns non-200', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const status = await issueSessionStatus(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V',
    });
    // Revoked codes are filtered out by GetByCode (status='active' WHERE
    // clause) → ErrCodeInvalid → unauthorized.
    expect(status).toBeGreaterThanOrEqual(400);
    await request.dispose();
  });
});

async function revokeCodeByName(
  request: APIRequestContext, csrf: string, codeStr: string,
): Promise<void> {
  const listRes = await request.get(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!listRes.ok()) throw new Error(`list codes: ${listRes.status()}`);
  const codes = await listRes.json() as Array<{ id: string; code: string }>;
  const target = codes.find((c) => c.code === codeStr);
  if (!target) throw new Error(`code ${codeStr} not found`);
  const res = await request.post(`${BACKEND}/api/admin/codes/${target.id}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`revoke ${codeStr}: ${res.status()}`);
}
