// iam-revoke-blocks-next-turn.spec.ts —— Revoking a code blocks the visitor's
// next message. RoleSnapshot freeze 设计的"唯一补救手段"。
//
// 用户故事：
//   visitor 用 code C 进了 session，第一条 message 正常拿回复。owner 在
//   admin /codes 上点 revoke C。visitor 同一 session 再发消息，应该 401
//   （session 持有的 code id 找不到 active code 了）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'revoke@example.com', password: 'correct-horse-battery-staple',
  handle: 'revoke', fullName: 'Revoke Owner',
};

const CODE = 'REVOKE-001';

test.describe('A.3-IAM revoke is the only remedy for a frozen session', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'revoke-spec' });
    await request.dispose();
  });

  test('revoke code → visitor next message rejected', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V',
    });
    // First turn under active code → 200.
    const firstRes = await sendMessage(request, sess, 'hello');
    expect(firstRes.status()).toBe(200);
    await firstRes.body();
    // Owner revokes.
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await revokeCodeByName(request, csrf, CODE);
    // Next turn under revoked code → not allowed.
    const secondRes = await sendMessage(request, sess, 'and then?');
    expect(secondRes.status()).toBeGreaterThanOrEqual(400);
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
