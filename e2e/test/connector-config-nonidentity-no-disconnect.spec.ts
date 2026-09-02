// connector-config-nonidentity-no-disconnect.spec.ts -- Section 3, decision
// D-5: editing a non-identity field (policy / calendar_id / display name)
// (edit-config) -> does **not** disconnect; connected/verified state is
// unchanged, booking stays available. Guards "only an identity change
// triggers re-verification".
//
// RED / TDD: a gate spec. After a refactor, editing a non-identity field like
// booking policy must never clear the token by mistake.
// If a refactor treats every "config write" as an identity change requiring
// re-verification, this test fails and catches the regression.
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
