// connector-config-nonidentity-no-disconnect.spec.ts —— §三 D-5 行
// 「改非身份字段（policy / calendar_id / 显示名）」(edit-config) → **不** disconnect，
// 连接/验证状态不动，booking 仍可用。守住「只有身份变才重验」。
//
// RED / TDD：守门 spec。重构后改 booking policy 之类的非身份字段绝不能误清 token。
// 若重构把「任何 config 写入」都当成 identity change 来重验，这条会失败 → 抓回归。
//
// Non-identity config edit (decision D-5): editing the booking policy (a
// non-identity field) MUST NOT disconnect the connector — connected/verified
// state is unchanged and calendar_book stays exposed.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { getGCalStatus, setBookingPolicy } from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';

test.describe('connector · non-identity config edit does NOT disconnect (§3 D-5)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('edit booking policy → connection unchanged, booking still available',
    async () => {
      const before = await getGCalStatus(seed.request);
      expect(before.connected).toBe(true);

      // change a NON-identity field: booking policy (working hours / lead).
      await setBookingPolicy(seed.request, seed.csrf, {
        min_lead_days: 2,
        working_hours_start: '08:00',
        working_hours_end: '20:00',
      });

      // connection/verified state untouched.
      const after = await getGCalStatus(seed.request);
      expect(after.connected).toBe(true);
      expect(after.has_credentials).toBe(true);

      // gate side: booking still exposed for a fresh session.
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      await expectCalendarBookExposed(seed.request, sess.session_token, true);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
