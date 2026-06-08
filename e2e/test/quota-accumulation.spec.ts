// quota-accumulation.spec.ts —— max_members=N 时:N 个不同名字都能进,第 N+1 个
// 不同名字被拒;已有名字再来不占名额(续会)。
//
// 用户故事:
//   "5 轮面试" = 5 个人(不是一个人 5 段)。max_members=N 给 N 个人用,第 N+1
//   个新名字才被拒;名单里的人回来照常进。

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
const MAX_MEMBERS = 3;
const NAMES = ['Sarah', 'Bob', 'Carol'];

test.describe('max_members admits N distinct names, blocks the (N+1)th', () => {
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

  test('N distinct names OK, (N+1)th blocked, existing name still resumes',
    async ({ request }) => {
      // N 个不同名字都能进。
      for (const name of NAMES) {
        const s = await issueSession(request, {
          handle: OWNER.handle, code: CODE, visitor_name: name,
        });
        expect(s.session_token).not.toBe('');
      }

      // 第 N+1 个**新**名字 → 满了,403。
      const overflow = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Dave',
      });
      expect(overflow).toBe(403);

      // 名单里的人(Sarah)回来 → 续会,仍 200(不占新名额)。
      const returning = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(returning).toBe(200);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A — 3 people',
    purpose: 'quota-accumulation spec',
    max_members: MAX_MEMBERS,
  });
}
