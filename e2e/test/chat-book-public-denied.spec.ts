// chat-book-public-denied.spec.ts —— public visitor (no access code).
// calendar.book MUST NOT appear in the tool list, regardless of owner
// state. Tool-not-in-spec is the canonical gating signal.

import { test } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

test.describe('chat · calendar.book gated out for public visitors', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('public-mode session does not see calendar.book in its tool spec',
    async () => {
      const visitor = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'public',
      });
      await expectCalendarBookExposed(seed.request, visitor.session_token, false);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
