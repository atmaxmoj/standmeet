// visitor-card-action-survives-reload.spec.ts —— F-B-9's **persistence half**.
//
// The sibling case (`visitor-card-action-enters-history.spec.ts`) proves "click the card, the
// next turn's model knows about it." That half lives only in the client's own in-memory
// message array — reload the page once and it's gone: the card on screen still says
// `CANCELLED` (the transcript gets rebuilt from the backend), but as far as the model's
// context is concerned, that event never happened. Two contradictory statements on the same
// screen — that's exactly this defect's shape.
//
// So this case adds exactly one thing: **reload once between the two turns.** When it's red,
// it means "this event never got stored." When it's green, it means "this event came back
// from the backend, not from something the client happened to still remember."
//
// The criterion still lands in the one place that's actually observable: the message sent to
// the model ([[test-covers-capability-not-face]]).

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Reload recruiter chat';

// CARD_EVENT_MARK —— only the card action's event writes this prefix. Using the tool name as
// a needle couldn't go negative: the tool list is already sitting in the system prompt
// regardless ([[assertion-that-cannot-fail]]).
const CARD_EVENT_MARK = '[card action]';

test.describe('F-B-9 · a card action outlives the page', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('after a reload the cancellation is still in what the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Drain the request ring buffer: the tag is the same on every run and the ring persists
      // across runs, so without clearing it this could match a leftover entry from the last run.
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(9, 15)] },
      });
      await ask(page, `book me a 30-minute chat, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booked card is the surface this defect lives on')
        .toBeVisible({ timeout: 30_000 });

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'),
        'the card itself knows: it flips to cancelled')
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });

      // Reload — the client's in-memory message array is cleared and rebuilt here; the event
      // can only come back from the backend.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 15_000 });
      // Prove the session actually restored first — otherwise if the next assertion goes red,
      // there's no way to tell "the event never got stored" from "the whole conversation
      // never came back" ([[two-guards-dying-at-one-line]]).
      await expect(page.locator('[data-testid="answer-body"]').first(),
        'the transcript comes back on screen')
        .toBeVisible({ timeout: 30_000 });

      const nextTag = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `is anything still on the books?${nextTag}`);

      await expect.poll(
        async () => (await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK)).found,
        { timeout: 30_000, message: 'the turn after the reload reached the model' },
      ).toBe(true);
      const req = await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK);

      expect(req.contains,
        'the cancellation survived the reload — it came back from the server, not from a tab '
        + 'that happened to stay open')
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
  await page.getByTestId('visitor-name-input').fill('Reload Robin');
  await page.getByTestId('visitor-email-input').fill('robin@example.com');
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
