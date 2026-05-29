// chat-book-skill-not-granted.spec.ts —— owner OAuth complete, but the
// code does NOT include calendar.book in granted_skills. Tool hidden.
//
// This is the "owner trusted you with chat but not with booking" case.

import { test } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

test.describe('chat · calendar.book gated out when not in granted_skills', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('code has granted_skills=[] → calendar.book absent from spec', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: [],
    });
    const visitor = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code,
      visitor_name: 'Plain Visitor',
    });
    await expectCalendarBookExposed(seed.request, visitor.session_token, false);
  });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
