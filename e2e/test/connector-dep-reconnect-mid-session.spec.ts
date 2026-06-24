// connector-dep-reconnect-mid-session.spec.ts —— 状态变更矩阵
// 「断联→重连 · 两 turn 间 · 下一 turn tool 重现」补。
//
// 镜像 disconnect-mid-session:起始断联(只配凭据、没 OAuth)→ booking 隐藏 →
// owner 完成 OAuth 连上 → 下一回合(新装配)booking **重新出现**。验证单点闸
// 既能踢出也能放回,且 per-turn 重算对「连上」这个方向同样生效。
//
// RED:重构落地前 per-turn 重算 / global 单点闸不存在 → 起始态本就可能算错、
// 或重连后不刷新 → 断言失败,符合 TDD 预期。

import { test } from '@/fixtures/test';

import {
  seedOwnerCredentialed, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import {
  initGCalOAuth, getGCalStatus,
} from '@/fixtures/gcal';
import {
  issueCodeWithSkills, expectCalendarBookExposed,
} from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · owner reconnect between turns reveals booking tool', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => {
    // 凭据已存、但未走 OAuth → connector 未连(refresh_token IS NULL)。
    seed = await seedOwnerCredentialed(playwright);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('disconnected → booking absent; owner completes OAuth → next session exposes booking',
    async () => {
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });

      // turn 1 (未连): calendar_book 不在 tool-spec 列表。
      const before = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, before.session_token, false);

      // owner 在两回合之间完成 OAuth → connector 连上。
      const { auth_url } = await initGCalOAuth(seed.request, seed.csrf);
      const res = await seed.request.get(auth_url);
      if (res.status() !== 200) throw new Error(`oauth flow: ${res.status()}`);
      const status = await getGCalStatus(seed.request);
      if (!status.connected) throw new Error('reconnect: not connected after OAuth');

      // 下一回合(新装配): 单点闸重算 → Requires:[calendar] 满足 → booking 重现。
      const after = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, after.session_token, true);
    });
});
