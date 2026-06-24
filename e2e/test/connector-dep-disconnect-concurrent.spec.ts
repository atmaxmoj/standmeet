// connector-dep-disconnect-concurrent.spec.ts —— 状态变更矩阵
// 「多 session 并发 · owner 断联 · 两 session 下一 turn 都失 tool」补。
//
// global 单点闸是「所有 visitor walk 唯一入口」—— 它对 connector 状态的重算是
// **全实例一刀切**,不分 session。本条造两个独立访客 session(两个 browser
// context / 两段 conversation),都拿到 booking;owner disconnect 日历后,**两个**
// session 的下一回合都必须丢掉 calendar_book —— 证明单点闸不是 per-session 缓存。
//
// RED:重构落地前 gating 若在 booker cap 内 per-session 自查且不 per-turn 重算,
// 已开的两个 session 可能继续看见 tool → 断言失败,符合 TDD 预期。

import { test } from '@/fixtures/test';
import type { Browser, BrowserContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { disconnectGCal } from '@/fixtures/gcal';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

test.describe('connector dep · owner disconnect drops booking for ALL concurrent sessions', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('two separate sessions both have booking; owner disconnects → both lose it next turn',
    async ({ browser }) => {
      // 两个独立访客:不同 browser context、同一张码下不同 member(唯一名隔离)。
      const a = await openVisitor(browser, seed, 'Alpha', 'alpha@example.com');
      const b = await openVisitor(browser, seed, 'Beta', 'beta@example.com');

      try {
        // 两个 session 装配时都已连 → 都拿到 calendar_book。
        await expectCalendarBookExposed(seed.request, a.sess.session_token, true);
        await expectCalendarBookExposed(seed.request, b.sess.session_token, true);

        // owner 断开日历(全实例一刀)。
        await disconnectGCal(seed.request, seed.csrf);

        // 两个 session 的下一回合都必须丢掉该 tool(单点闸全局重算,非 per-session)。
        await expectCalendarBookExposed(seed.request, a.sess.session_token, false);
        await expectCalendarBookExposed(seed.request, b.sess.session_token, false);
      } finally {
        await a.ctx.close();
        await b.ctx.close();
      }
    });
});

interface OpenedVisitor { ctx: BrowserContext; sess: VisitorSession }

// openVisitor —— 起一个独立 browser context + 在同一张码下用唯一名颁一个
// code session(不同 member)。返回 context(收尾用)+ session。
async function openVisitor(
  browser: Browser, seed: CodedSeed, name: string, email: string,
): Promise<OpenedVisitor> {
  const ctx = await browser.newContext();
  const sess = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code,
    visitor_name: name, visitor_email: email,
  });
  return { ctx, sess };
}
