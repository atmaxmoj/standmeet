// quota-accumulation.spec.ts —— 配额 N 时累积 N 次 OK，第 N+1 次 403。
//
// 用户故事：
//   "5 轮面试" 字面意思：max_sessions_per_member=5。Sarah 真的能用满 5 次，
//   第 6 次才被拒。不是 quota=1 那种 binary。

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

const CODE = 'INTERVIEW-A3';
const MAX_SESSIONS = 3;

test.describe.serial('per-member quota accumulates up to N, blocks at N+1', () => {
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

  test('Sarah issues N sessions OK, (N+1)th blocked', async ({ request }) => {
    for (let i = 0; i < MAX_SESSIONS; i++) {
      const s = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(s.session_token).not.toBe('');
    }
    const overStatus = await issueSessionStatus(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
    });
    expect(overStatus).toBe(403);
  });
});

async function issueCodeWithQuota(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A — 3 sessions',
    purpose: 'quota-accumulation spec',

    max_sessions_per_member: MAX_SESSIONS,
  });
}
