// member-quotas.spec.ts —— 同一个 code 给两个人，配额按 member 独立计数。
//
// 用户故事：
//   owner 给 HR 团队发 INTERVIEW-A1（max_sessions_per_member=1）。Sarah
//   开了一个 session，再开第二个被拒。Bob 用同一个码、不同名字，第一个
//   session 仍然能开。
//
// 全部走 API （visitor 侧 helper），UI 在 gate-access.spec.ts 已经验证。

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

test.describe.serial('per-member quota counts independently for each visitor name', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithQuota(request);
    await request.dispose();
  });

  test('Sarah blocked on 2nd session, Bob still allowed', async ({ request }) => {
    const first = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
    });
    expect(first.session_token).not.toBe('');

    const secondStatus = await issueSessionStatus(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
    });
    expect(secondStatus).toBe(403);

    const bob = await issueSessionStatus(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Bob',
    });
    expect(bob).toBe(200);
  });
});

async function issueCodeWithQuota(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // helper 不需要 token，但保留 createAPIToken 一致性
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A',
    purpose: 'member-quota spec',
    included_tags: [],
    max_sessions_per_member: 1,
  });
}
