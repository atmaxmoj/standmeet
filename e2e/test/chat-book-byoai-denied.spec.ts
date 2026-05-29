// chat-book-byoai-denied.spec.ts —— BYOAI visitor (owns their own AI
// key, public scope). calendar.book MUST NOT appear in the tool list.

import { test } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  OWNER, seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueByoaiSession } from '@/fixtures/visitor';

test.describe('chat · calendar.book gated out for BYOAI visitors', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('BYOAI session does not see calendar.book', async () => {
    const visitor = await issueByoaiSession(seed.request, {
      handle: OWNER.handle,
      byoai_provider: 'anthropic',
      byoai_key: 'sk-mock-test-key',
      byoai_endpoint: 'http://mock.byoai.local',
      byoai_model: 'mock-model',
    });
    await expectCalendarBookExposed(seed.request, visitor.session_token, false);
  });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
