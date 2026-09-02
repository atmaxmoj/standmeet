// claim-needs-a-receipt.spec.ts — F-A-37. When a reply says it did something on the
// visitor's behalf, that turn must carry a receipt for it; if there isn't one -> the
// product says so plainly next to it, instead of letting that claim stand as-is.
//
// What it looks like in the real environment: after four real bookings in a row, the
// fifth reply is *"Booked. ✅ Monday, August 31 · 13:00–13:30 UTC … Invite went to …
// That's all three on the calendar"*, while that turn's backend log has **zero**
// `agent tool start` entries, the real calendar is empty all day, and there's no receipt
// card in the chat. The visitor walks away believing in a meeting that doesn't exist.
// The browser only replays `{role, content}` history, so what the model reads back is
// four "Booked" lines it wrote itself — what it ends up completing is that sentence, not
// the action.
//
// **Why this can run deterministically**: the gate is judged by the host (the capability
// declares in its manifest "which statements count as a claim, which tool counts as its
// receipt"; the kernel only asks whether this turn satisfies that), so this doesn't need
// to gamble on a real model — the script makes the model only talk, never call a tool,
// and the gate must fire. The real-model side is separately probed repeatedly by
// `make eval-booking-fabrication`.
//
// The criterion lives where the visitor can see it: the product's own words.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

// FABRICATED — a reply that only talks and does nothing, shaped exactly like the one from
// the real environment.
const FABRICATED = 'Booked. ✅ Monday, August 31 · 13:00–13:30 UTC — topic: "progress state '
  + 'check." Invite went to visitor@example.com.';

test.describe('F-A-37 · a claim without a receipt does not stand', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the model says it booked, calls nothing → the visitor is told nothing was done',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wren');

      const tag = await scriptMockReplyText(page.request, FABRICATED);
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me something next week${tag}`);
      await input.press('Enter');

      // The lie streams out as usual (text already sent can't be unsent) — what's
      // asserted is the product's own sentence right next to it.
      await expect(page.getByTestId('answer-partial-notice'),
        'the product says the action did not happen')
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('answer-partial-notice'))
        .toContainText(/nothing was actually done/i);
      await ctx.close();
    });

  test('the same claim WITH the tool called stands untouched',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wynn');

      // Takes the real-tool path: the card rendering = the receipt exists, and the gate
      // must let it through.
      const { scriptMockToolCall } = await import('@/fixtures/mock-llm-script');
      const tag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(7, 14)] },
      });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me a 30-minute chat${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booking really happened').toBeVisible({ timeout: 20_000 });
      // The gate is a necessary condition, not a censor: a claim backed by a receipt
      // should not get annotated.
      await expect(page.getByTestId('answer-partial-notice'),
        'a backed claim carries no correction').toHaveCount(0);
      await ctx.close();
    });

  // A gate that wrongly flags a correct **refusal** costs more than the lie it's meant to
  // catch: the visitor gets told "nothing happened", when the product actually did
  // correctly tell them that time can't be booked. A refusal naturally contains the word
  // "booked" (as in "already booked"), so this test checks whether the phrase list is
  // broad enough to accidentally sweep it in.
  test('a refusal that says the slot is already booked is not a claim',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wade');

      const tag = await scriptMockReplyText(page.request,
        "That time is already booked — the slot you asked for is booked solid. "
        + 'Want me to look at the next morning instead?');
      const input = page.getByTestId('chat-input-field');
      await input.fill(`can you take 9am next Tuesday${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('answer-body').last(),
        'the refusal rendered').toContainText(/already booked/i, { timeout: 20_000 });
      await expect(page.getByTestId('answer-partial-notice'),
        'a refusal is not a claim — no correction belongs on it').toHaveCount(0);
      await ctx.close();
    });
});

async function enterChat(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 3,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
