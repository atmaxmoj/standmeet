// connector-dep-half-config.spec.ts —— 状态变更矩阵
// 「配了凭据、未授权(no refresh_token) · 装配 · Connected=false → 隐藏」补
// (half-config 边界)。
//
// owner 存了 GCal client_id/secret 但**从没走完 OAuth**(没有 refresh_token)。
// connected 谓词必须 = false → Requires:[calendar] 的 booker cap 不进 enabledCaps
// → calendar_book tool 在 session tool-spec 里**缺席**。半配 ≠ 已连。
//
// 注:这跟 chat-book-not-connected 同起点(seedOwnerCredentialed),但那条从
// 「访客持权但 owner 没连」角度断言;本条明确盯住「凭据已存 / refresh_token IS
// NULL」这个生命周期格子,属 connector-deps 矩阵补的边界用例。
//
// RED:重构落地前若 connected 谓词只看 has_credentials 不看 refresh_token,
// 半配会被误判为已连 → tool 误暴露 → 断言失败,符合 TDD 预期。

import { test, expect } from '@/fixtures/test';

import {
  seedOwnerCredentialed, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { getGCalStatus } from '@/fixtures/gcal';
import {
  issueCodeWithSkills, expectCalendarBookExposed,
} from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · credentials saved but OAuth never completed → booking hidden', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => {
    // saveGCalCredentials 跑了,但**没有** initGCalOAuth/callback → no refresh_token。
    seed = await seedOwnerCredentialed(playwright);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('has_credentials true but connected false → calendar_book absent from session',
    async () => {
      // 前置事实:半配 = 有凭据、未连。
      const status = await getGCalStatus(seed.request);
      expect(status.has_credentials, 'credentials were saved').toBe(true);
      expect(status.connected, 'but OAuth never completed → not connected').toBe(false);

      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const visitor = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });

      // connected 谓词 false → 即便码授予 calendar.book,tool 也必须隐藏。
      await expectCalendarBookExposed(seed.request, visitor.session_token, false);
    });
});
