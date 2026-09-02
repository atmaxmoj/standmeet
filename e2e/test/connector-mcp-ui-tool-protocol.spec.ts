// connector-mcp-ui-tool-protocol.spec.ts -- Section 1 (mcp-ui:tool protocol)
//
// The new host protocol: a sandboxed card posts
// `{type:'mcp-ui:tool', name, args}` -> the host dispatches that named tool
// carrying **session context** -> posts `{type:'mcp-ui:tool-result', ...}`
// back to the card. This spec verifies the whole round trip: the card sends a
// named tool call -> the host dispatches it -> the result returns to the
// card. The sandbox is cross-origin, so postMessage internals can't be probed
// directly; instead this asserts the protocol really worked via
// **observable side effects**:
//   - the card's action (cancel) actually triggered the tool (the GCal event
//     was deleted = calendar_cancel ran)
//   - after tool-result returns to the card, the card reaches its matching
//     terminal state (cancelled) = the card received the result and
//     re-rendered from it
//
// Driven with the booked card (its cancel/confirm actions go through exactly
// mcp-ui:tool): book -> iframe card -> click cancel -> assert the tool's side
// effect happened (event deleted + card terminal state).
//
// RED / TDD: fails at runtime until the mcp-ui:tool host protocol lands and
// the booked card calls calendar_cancel through it.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · mcp-ui:tool host protocol round-trip (§1)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('sandbox card posts mcp-ui:tool → host dispatches → tool runs (observable effect) → tool-result re-renders card',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Pia', 'pia@example.com', 14);

      // Booking landed a real GCal event (protocol precondition: the card has
      // an object the tool can act on).
      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // Click cancel on the card -> the card posts
      // {type:'mcp-ui:tool', name:'calendar_cancel', args}.
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();

      // Observable evidence the upstream leg of the round trip worked: the
      // host dispatched calendar_cancel carrying session context, and the
      // tool deleted that event through the connector proxy (the side effect
      // = the tool really ran on the host side, not the card faking it).
      await expect.poll(
        async () => (await getMockEvents(seed.request)).some((e) => e.event_id === eventID),
        { timeout: 10_000, message: 'calendar_cancel tool removed the event' },
      ).toBe(false);

      // Observable evidence the downstream leg of the round trip worked: the
      // host posts back {type:'mcp-ui:tool-result'}, and the card re-renders
      // into the cancelled terminal state (the action disappears) from it.
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

      await ctx.close();
    });
});

// bookedFrame -- the booked sandboxed-card iframe; content is reached via frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook -- enter via ?code -> name+email -> script one calendar_book
// call -> trigger it -> wait for the booked sandboxed-card iframe to appear.
async function enterAndBook(
  page: Page, code: string, name: string, email: string, hour: number,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
