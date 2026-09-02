// connector-non-sandbox-cards-empty.spec.ts — once booked's externalization is
// finished, the frontend's NON_SANDBOX_CARDS no longer has any card hardcoded by
// capability (only the generic skill_*/ext_* dump fallback remains). Observable
// proxy: in a booking flow, the booked card is the `mcp-app-card-calendar_book`
// sandbox iframe, and the old hardcoded React card `tool-card-calendar_book`
// **does not exist** in the main DOM. This is equivalent to "the hardcoded card list
// is empty (the booked entry is now externalized)".
// (connector-deps-tests.md §1 non-sandbox-cards-empty)
//
// RED until: the calendar_book card is served as a ui:// sandbox card by the booker
// plugin.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('connector · booked card is a sandbox iframe; no hardcoded capability card in main DOM', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book → mcp-app-card-calendar_book iframe appears; main DOM has no hardcoded tool-card-calendar_book',
    async ({ browser }) => {
      const tag = await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'sandbox check', duration_min: 30, preferred_times: [future()] },
      });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);
      await fireTurn(page, `book me a meeting${tag}`);

      // booked card = sandbox iframe.
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'booked card rendered as sandbox iframe').toBeVisible({ timeout: 20_000 });
      // No old hardcoded React card in the main DOM (it's now externalized, not in
      // NON_SANDBOX_CARDS).
      await expect(page.getByTestId('tool-card-calendar_book'),
        'hardcoded booked card retired').toHaveCount(0);

      await ctx.close();
    });
});

async function enterChat(page: Page, code: string): Promise<void> {
  await enterCodeSession(page, code);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function fireTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
