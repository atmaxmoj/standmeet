// member-quotas.spec.ts —— max_members:一张码最多几个不同名字(人)。
//
// 用户故事:
//   owner 发 INTERVIEW-A1(max_members=1)—— 只给一个人用。Sarah 用她的名字
//   进来 ok;她再用同一个名字进来还是 ok(同名 = 同一个人,续上她那段会)。
//   Bob 用同一张码、**不同名字**进来 → 被拒(名额满了,只允许 1 个名字)。
//
// 全部走 API(visitor 侧 helper),UI 流在 max-members.spec.ts 验证。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-A1';

test.describe('max_members caps the number of distinct names on a code', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithMaxMembers(request);
    await request.dispose();
  });

  test('same name always allowed (resumes); a different name is blocked when full',
    async ({ request }) => {
      // Sarah(第 1 个名字)→ ok。
      const first = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(first.session_token).not.toBe('');

      // Sarah 再来 = 同一个人,续上 → 仍然 ok(不占新名额)。
      const sarahAgain = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(sarahAgain).toBe(200);

      // Bob = 第 2 个名字,max_members=1 已满 → 403。
      const bob = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Bob',
      });
      expect(bob).toBe(403);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A',
    purpose: 'member-quota spec',
    max_members: 1,
  });
}
