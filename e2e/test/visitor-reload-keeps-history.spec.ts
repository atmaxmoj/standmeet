// visitor-reload-keeps-history.spec.ts —— after a visitor reloads once, **can the
// model still see the messages that are still on screen**?
//
// Why ask this: this is exactly where F-B-9's persistence half is stuck. For a card's
// event to survive a reload, **the entire history** has to survive the reload first.
// But this conversation is client-driven (`use-chat.ts` holds onto `messageHistRef`
// and sends it as History every turn), and on reload `restoreSession` only rebuilds
// the **transcript** (`setDialogs`) — reading the code alone can't tell you whether it
// also refills that message array, so this test actually runs it once to find out.
//
// The criterion sits at the only place that's actually observable: **the message sent
// to the model**. The sentence being present on screen doesn't count — that's exactly
// the shape of this whole family of defects ([[test-covers-capability-not-face]]).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

// MEMORABLE —— a phrase in the first turn unique to this spec. Looked for in the
// second turn's request.
const MEMORABLE = 'pineapple-lighthouse-42';

test.describe('a reload keeps the conversation the model can see', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: [] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('after refreshing, the earlier turn is still in what the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      const first = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `Remember this word: ${MEMORABLE}${first}`);
      await expect(page.locator('[data-testid="answer-body"]').last())
        .toBeVisible({ timeout: 30_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 15_000 });
      // The transcript really did come back — prove this half first, or a failure
      // below can't distinguish "history was lost" from "the whole session never
      // restored after the reload".
      await expect(page.locator('[data-testid="answer-body"]').first(),
        'the transcript comes back on screen')
        .toBeVisible({ timeout: 30_000 });

      const second = await scriptMockReplyText(page.request, 'still noted');
      await ask(page, `What was the word?${second}`);

      await expect.poll(
        async () => (await lastGatewayRequest(page.request, second, MEMORABLE)).found,
        { timeout: 30_000, message: 'the second turn reached the model' },
      ).toBe(true);
      const req = await lastGatewayRequest(page.request, second, MEMORABLE);

      expect(req.contains,
        'the first turn is still in the context — the visitor can see it on screen, so an answer '
        + 'that has forgotten it is the product contradicting its own transcript')
        .toBe(true);

      await ctx.close();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Reload Rachel');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}
