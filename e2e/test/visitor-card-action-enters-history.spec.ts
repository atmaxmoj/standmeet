// visitor-card-action-enters-history.spec.ts — F-B-9 ⭐⭐: **what the visitor does on a card,
// the agent must know on the next turn.**
//
// Caught over two consecutive turns in prod (2026-08-18): I clicked `Cancel meeting` on the
// confirmation card, the card flipped to `CANCELLED`, the time struck through; the next turn
// asked the AI to cancel a different meeting, and it casually replied
// *"Your Thursday, August 27 at 10:00 AM intro call is still on the books."*
// Two contradictory statements on the same screen, and one of them is false.
//
// The mechanism doesn't need guessing — you can read straight through both paths
// (`use-mcp-app-card.ts:75` → `callVisitorTool` → `POST /sessions/{id}/tools/{name}`, see
// `routes/public/tools.go`): that handler assembles, executes, and returns — **never touching
// the conversation from start to finish**. Meanwhile visitor conversations are **client-driven**
// — each turn sends up whatever message list the client is currently holding as History. The
// card's call never entered that list, so as far as the agent is concerned it never happened.
//
// The criterion targets **the one place this fact is actually visible**: the message sent to the
// model. It doesn't assert what the model said (that's probabilistic — see the
// [[faicheck-deterministic-llm-loop-bug]] family); it asserts whether this fact **made it into
// its context or not**. The mock gateway has always kept the full text of every request, it just
// never let anyone ask about it before; now `?contains=` makes it answerable.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Recruiter chat';

// CARD_EVENT_MARK — looks for **the event itself**, not the tool name.
//
// The first version's needle was `calendar_cancel`, but the tool list already lives in the
// system prompt anyway — that assertion would pass green even if the product did nothing at all
// ([[assertion-that-cannot-fail]]). This prefix is only ever written by `cardEventText`, so a hit
// means this event genuinely made it into the context.
const CARD_EVENT_MARK = '[card action]';

test.describe('F-B-9 · what the visitor does on a card reaches the next turn', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('cancelling on the card puts it in the history the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Flush the request log ring: the tag is the same on every run, but the ring survives
      // across runs — without clearing it, this criterion would match the record left over from
      // **the previous run**, and from then on could never go red on a real failure (I actually
      // hit a false green from exactly this once).
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      // 1) Genuinely book a meeting first — the card is where this defect lives; without a
      // card there's no cancel button to click.
      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await ask(page, `book me a 30-minute chat next week, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booked card is the surface this defect lives on')
        .toBeVisible({ timeout: 30_000 });

      // 2) Click cancel on the card — this goes through the mcp-ui:tool path, not through the
      // conversation.
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'),
        'the card itself knows: it flips to cancelled')
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });

      // 3) Ask another question — the History sent for this turn should carry "cancelled on
      // the card."
      const nextTag = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `is anything still on the books?${nextTag}`);

      const req = await expect.poll(
        async () => (await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK)).found,
        { timeout: 30_000, message: 'the next turn actually reached the model' },
      ).toBe(true).then(() => lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK));

      expect(req.contains,
        'the cancellation the visitor made on the card is in the context this turn was sent with '
        + '— otherwise the agent answers about a meeting that no longer exists')
        .toBe(true);

      await ctx.close();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Rachel');
  await page.getByTestId('visitor-email-input').fill('rachel@example.com');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
