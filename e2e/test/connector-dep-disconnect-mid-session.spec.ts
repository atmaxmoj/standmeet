// connector-dep-disconnect-mid-session.spec.ts —— 状态变更矩阵
// 「已连→断联(owner disconnect) · 两 turn 间 · 下一 turn 该 tool 隐藏(单点闸重算)」补。
//
// connector gating 收进 enabledCaps 这个 global 单点闸后,connector 连接状态
// 在**每次 session 装配(per-turn)**重算。本条验证:code visitor 在已连 owner 上
// 第一回合 calendar_book 暴露;owner 在两回合之间 disconnect 日历;下一回合该
// tool **必须消失**(发新 session 看 tool-spec 列表 + chat 回合里 AI 调不动)。
//
// RED:重构落地前 gating 走 booker cap 里写死的 Connected() 自查、且不 per-turn
// 重算 → tool 仍在 → 本条断言失败,符合 TDD 预期。

import { test } from '@/fixtures/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { disconnectGCal } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector dep · owner disconnect between turns hides booking tool', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connected → booking exposed; owner disconnects → next session has no booking tool',
    async () => {
      // turn 1 (装配时已连): calendar_book 在 tool-spec 列表里。
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, true);

      // owner 在两回合之间断开日历连接。
      await disconnectGCal(seed.request, seed.csrf);

      // 下一回合 = 重新装配一个 fresh session。单点闸重算 connector 状态 →
      // 所有 Requires:[calendar] 的 cap(含 booker)被踢出 enabledCaps → 隐藏。
      const next = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: seed.code.code,
        visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
      });
      await expectCalendarBookExposed(seed.request, next.session_token, false);

      // 同一旧 session 的下一 turn 也应看不到该 tool(per-turn 重算,非 per-session)。
      await expectCalendarBookExposed(seed.request, seed.visitor.session_token, false);
    });
});
