// connector-booked-card-sandbox.spec.ts —— §1 (booked-card externalized)
//
// After the refactor: a successful calendar_book renders as the **sandboxed iframe card**
// served by the booker plugin's ui:// (`mcp-app-card-calendar_book`), retiring the last
// hardcoded React card (`tool-card-calendar_book`, `NON_SANDBOX_CARDS` emptied). What this
// guards is the fact that **externalization actually happened**: booking succeeds → the
// iframe shows up in the main DOM, and the old React card does **not**; the iframe content
// (the booked confirmation) is reachable through frameLocator.
//
// RED / TDD: before the booked card is actually turned into a ui:// sandbox iframe, this
// test fails at runtime (the old React card is still in the main DOM, no
// mcp-app-card-calendar_book iframe exists).

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · booked card is a ui:// sandbox iframe (§1 externalized)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book succeeds → mcp-app-card-calendar_book IFRAME appears; old React card not in main DOM',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Sandy', 'sandy@example.com', 14);

      // Externalized card: the outer host container (an iframe) is visible in the main DOM.
      const host = page.getByTestId('mcp-app-card-calendar_book');
      await expect(host, 'booked sandbox card host visible').toBeVisible({ timeout: 20_000 });
      // It's genuinely an iframe (sandboxed), not a plain div.
      expect(await host.evaluate((el) => el.tagName.toLowerCase())).toBe('iframe');

      // The old hardcoded React card is **not in the main DOM** (NON_SANDBOX_CARDS emptied).
      await expect(page.locator('body > * [data-testid="tool-card-calendar_book"]'))
        .toHaveCount(0);

      // The iframe content (the booked confirmation) is reachable through frameLocator —
      // proof that rendering actually happens inside the sandbox.
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
      await expect(frame.getByTestId('book-card-time')).toBeVisible({ timeout: 10_000 });

      // **This card is the visitor's own receipt, so the time must carry its zone** (UX-69).
      // The body message spells out both time zones, but the body scrolls away while the
      // card stays put — a recruiter in a different zone would see "8:00 AM" with nothing
      // telling them whose 8 o'clock that is. booking-slots' LOOK criterion demands this
      // literally, word for word:
      // "Every time carries its zone, because a bare clock time is ambiguous to anyone
      //  not in the owner's zone."
      const when = await frame.getByTestId('book-card-time').innerText();
      expect(when, `卡上的时间要带时区,拿到的是 ${when}`)
        .toMatch(/\b(UTC|GMT|[A-Z]{2,5}T|GMT[+-]\d{1,2})\b/);

      await ctx.close();
    });
});

// enterAndBook — ?code entry → name+email → script one calendar_book → trigger it → wait
// for the booked sandbox card iframe to appear.
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
