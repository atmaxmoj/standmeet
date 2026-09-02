// visitor-chat-list-slots.spec.ts -- #124: calendar_list_slots's result renders as a
// "collapsible calendar card" (a react-day-picker month grid + the selected day's time
// chips), replacing the old 50-line flat list. Made deterministic: the mock LLM scripts
// one list_slots call, the owner is wired to a mock gcal (empty calendar -> open slots),
// and the browser asserts the card's structure + collapsing + a chip click landing one
// booking message.
//
// User story:
//   1. a code visitor enters chat
//   2. the AI (mocked) calls calendar_list_slots (a future window) -> gets back
//      several 30-minute open slots
//   3. SlotsCalendarCard renders: <details open> + "available · N slots" + the month
//      grid + the selected day's time chips
//   4. clicking the summary collapses it; clicking a time chip -> a new "you" turn
//      carrying "book the ... slot"

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('visitor chat · calendar_list_slots → collapsible calendar card (#124)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('renders calendar card + time chips; collapses; chip click books the slot',
    async ({ browser, playwright }) => {
      const req = await playwright.request.newContext();
      const tag = await scriptMockToolCall(req, {
        name: 'calendar_list_slots',
        // +3..+5 days clears the 1-day lead; mock FreeBusy is empty → slots
        // come back inside the 09:00–18:00 UTC working window.
        args: {
          from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
          duration_min: 30, step_min: 60,
        },
      });
      await req.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);
      await fireTurn(page, `what afternoons are open next week?${tag}`);

      // The slots card (the booker plugin's ui:// sandboxed iframe) appears; its
      // content is read through frameLocator.
      await expect(page.getByTestId('mcp-app-card-calendar_list_slots'),
        'calendar card visible').toBeVisible({ timeout: 20_000 });
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_list_slots"]');
      const card = frame.getByTestId('tool-card-calendar_list_slots');
      // collapsible <details>, default-open
      await expect(card).toHaveJSProperty('open', true);
      await expect(frame.getByTestId('bookings-kicker')).toContainText('available ·');
      // public day picker rendered (day buttons grouped from the slots)
      await expect(frame.getByTestId('slot-calendar')).toBeVisible();
      await expect(frame.getByTestId('slot-day').first()).toBeVisible();
      // time chips for the selected day
      const chips = frame.getByTestId('tool-card-slot');
      await expect(chips.first()).toBeVisible();

      // wait for the turn to settle before toggling — list_slots isn't
      // return-directly, so a final answer streams after the card; interacting
      // mid-stream races the chat's re-renders.
      //
      // What's waited on is `chat-progress` disappearing, **not** `answer-body`
      // becoming visible. The latter goes true the instant the first token lands --
      // it can't tell "this turn finished" from "still streaming", so this wait would
      // wait for nothing exactly when it's needed most (a long answer). The full-suite
      // run went red on the second click below: the element kept moving, and
      // Playwright's stability check never settled. The product has its own landing
      // receipt -- that line only renders while the final dialog is still pending, and
      // the whole line disappears the moment it lands.
      await expect(page.getByTestId('chat-progress')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator('[data-testid="answer-body"]').last())
        .toBeVisible({ timeout: 20_000 });

      // collapse + re-open works
      const summary = card.locator('summary').first();
      await summary.click();
      await expect(card).toHaveJSProperty('open', false);
      await summary.click();
      await expect(card).toHaveJSProperty('open', true);

      // clicking a chip fires a new turn carrying the booking phrasing
      await chips.first().click();
      const dialogs = page.locator(
        '[data-testid="conversation-deck"] article, [data-testid="chatroom"] article',
      );
      await expect(dialogs.last()).toContainText(/book the .* slot/i, { timeout: 5_000 });

      await ctx.close();
    });
});

// enterCodeSession has already skipped the name picker and waited for /sessions 200;
// don't dismiss it a second time (that can sample the picker's unmount window ->
// a click times out at 10s, a check-then-act race).
async function enterChat(page: Page, code: string): Promise<void> {
  await enterCodeSession(page, code);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function fireTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
