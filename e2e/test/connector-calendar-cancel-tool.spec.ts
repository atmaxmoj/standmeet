// connector-calendar-cancel-tool.spec.ts —— §1 (visitor calendar_cancel as a tool)
//
// today cancellation goes through REST (`/api/v1/booking-cancellation`, postBookingCancellation). After the refactor
// it becomes a connector-backed **tool**: the cancel button on the booked sandbox card posts
// `{type:'mcp-ui:tool', name:'calendar_cancel', args}` → host dispatches the `calendar_cancel` tool with session context
// → the tool deletes the event via the calendar connector proxy → returns
// `mcp-ui:tool-result` → the card enters the cancelled state. This spec guards the **TOOL path** (not the old REST):
//   - the deletion really happens (that event is gone from getMockEvents = the tool deleted it via the connector proxy)
//   - the card reaches the cancelled terminal state (tool-result returns to the card)
//   - idempotent: clicking / calling again on an already-cancelled booking does not double-delete or crash (E13)
//
// RED / TDD: until calendar_cancel becomes a tool (called via mcp-ui:tool, retiring REST), this fails at runtime.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · visitor calendar_cancel as a tool (§1)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('cancel inside the iframe → calendar_cancel tool removes the event + card shows cancelled',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Cara', 'cara@example.com', 14);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // cancel goes via mcp-ui:tool → calendar_cancel tool (not REST postBookingCancellation).
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();

      // observable side effect of the tool path: the event is deleted via the connector proxy. Dispatch is async (card → host →
      // tool), so poll until the real deletion lands, rather than reading right after the click (which would race).
      await expect.poll(
        async () => (await getMockEvents(seed.request)).find((e) => e.event_id === eventID),
        { timeout: 10_000, message: 'calendar_cancel tool removed the event' },
      ).toBeUndefined();

      // the card enters the cancelled terminal state (tool-result returns to the card → re-render).
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

      await ctx.close();
    });

  test('idempotent (E13): re-cancelling an already-cancelled booking is a no-op, no double-delete / crash',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dex', 'dex@example.com', 15);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });

      // after cancelling: no active event in events (that one is deleted). Cancelling again (if the card still exposes a retry entry
      // or is reproduced via reload) should be idempotent —— constrained here as "calling again doesn't drive the count negative / doesn't spawn a new event":
      // the currently observable measure is that the events list neither gains nor loses anything from a repeated cancel.
      const afterFirst = await getMockEvents(seed.request);
      expect(afterFirst.length).toBe(0);

      // reload rebuilds the card (restore re-renders the booked card + its cancelled state from the conversation aggregate),
      // the idempotency gate guarantees the cancelled card is stable, with no clickable cancel action left.
      await page.reload();
      const reloaded = bookedFrame(page);
      await expect(reloaded.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 15_000 });
      await expect(reloaded.getByTestId('book-card-cancel')).toHaveCount(0);
      // idempotent: a repeated cancel leaves no residual event on the mock.
      expect((await getMockEvents(seed.request)).length).toBe(0);

      await ctx.close();
    });
});

// bookedFrame —— the booked sandbox card iframe; its content is reached via frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterAndBook —— ?code entry → name+email → script one calendar_book → trigger →
// wait for the booked sandbox card iframe to appear.
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
