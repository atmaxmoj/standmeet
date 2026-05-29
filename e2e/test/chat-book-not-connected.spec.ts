// chat-book-not-connected.spec.ts —— code visitor with granted_skills
// includes calendar.book, BUT owner hasn't completed OAuth. Tool must
// stay hidden — visitor can hold a permission for something that
// doesn't exist on the owner side.

import { test } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { issueCodeWithSkills, expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  OWNER, seedOwnerCredentialed, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

test.describe('chat · calendar.book gated out when owner not authorized', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('code grants calendar.book but owner has only credentials (no token)',
    async () => {
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const visitor = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code,
        visitor_name: 'Recruiter Rachel',
      });
      await expectCalendarBookExposed(seed.request, visitor.session_token, false);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerCredentialed(playwright);   // creds saved but NOT OAuthed
}
