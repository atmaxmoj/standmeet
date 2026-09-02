// visitor-chat-book-card.spec.ts — a successful calendar_book renders a "booking
// confirmed" card.
//
// After the refactor (connector deps, §2): the booked card is a sandboxed iframe served
// by the booker plugin's ui:// (`mcp-app-card-calendar_book`), no longer a hardcoded
// React card in the main DOM (`tool-card-calendar_book`, `NON_SANDBOX_CARDS` is now
// empty). The card's content (time + GCal link + cancel/confirmation widget) lives inside
// the iframe, reached via frameLocator.
//
// This spec guards **the card's rendering contract**: book succeeds -> the iframe card
// appears -> it carries a time + a link to the real GCal event. cancel /
// send_confirmation behavior are covered separately by visitor-cancel-booking /
// booking-confirmation-email.
//
// Flow:
//   1. seed a code with calendar.book + max_bookings
//   2. a scripted mock calls calendar_book -> the booked sandboxed card iframe appears
//   3. frameLocator into the iframe, assert book-card-time + book-card-link
//      (href -> calendar.google)

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const MAX_BOOKINGS = 3;
const TOPIC = 'Recruiter chat';

test.describe('chat · booked card renders as mcp-app-card iframe', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book 成功 → mcp-app-card-calendar_book iframe 出现,内含 time + GCal 链接',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Rachel', 'rachel@example.com');

      // scripted calendar_book (+7 days, a known weekday, a fixed hour within working hours).
      const tag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, 14)] },
      });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me a 30-minute chat next week, please${tag}`);
      await input.press('Enter');

      // The booked card is a sandboxed iframe: the outer testid is visible in the main
      // DOM, while the content is reached via frameLocator (no longer the React
      // tool-card-calendar_book in the main DOM).
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'booked card iframe visible').toBeVisible({ timeout: 20_000 });
      const frame = bookedFrame(page);
      // The "booked" confirmation inside the card: time + a link to the real GCal event.
      await expect(frame.getByTestId('book-card-time')).toBeVisible();
      await expect(frame.getByTestId('book-card-link'))
        .toHaveAttribute('href', /calendar\.google/);

      await ctx.close();
    });
});

// bookedFrame — the externalized booked card is a sandboxed iframe; its content is
// reached via frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterChat — ?code entry -> fill name + email in the name picker -> submit -> wait for
// the session -> chatroom ready.
async function enterChat(
  page: Page, code: string, name: string, email: string,
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
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: MAX_BOOKINGS,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
