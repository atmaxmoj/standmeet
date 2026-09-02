// connector-err-confirmation-idempotent.spec.ts — §4 E14
// Resending the confirmation email does not double-send: a visitor clicks "send
// confirmation" twice on the BookCard → the inbox still holds only 1 email
// (send_confirmation is idempotent / the card locks the moment it's clicked, never
// double-sends). Modeled on booking-confirmation-email.
//
// RED / TDD: goes green once send_confirmation's duplicate guard (lock the card on
// click + backend idempotency) is in place.
//
// Error stream E14 (idempotency): sending the confirmation email twice does not
// double-send — Mailpit count stays at 1.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo, countMailpitMessages,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

test.describe('connector error stream · confirmation email is idempotent (E14)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('clicking "send confirmation" twice → exactly one email goes out',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 14);

      const prompt = bookedFrame(page).getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });

      // first send.
      await prompt.getByTestId('booking-email-use-profile').click();
      await waitForMailEnvelopeTo(seed.request, 'dana.profile@example.com');
      // card locks after a successful send (sent=true) → the action is gone, can't
      // double-click. Idempotency is enforced at the UI; the backend de-dupes too.
      await expect(prompt).toHaveAttribute('data-sent', 'true', { timeout: 5_000 });

      // attempt a second send via the same tool call (bypassing the locked UI),
      // simulating a retry / double-fire — must NOT produce a second email.
      const tag = await scriptMockToolCall(page.request, {
        name: 'send_confirmation',
        args: { to: 'dana.profile@example.com' },
      });
      const input = page.getByTestId('chat-input-field');
      const answersBefore = await page.getByTestId('answer-body').count();
      await input.fill(`please resend that confirmation${tag}`);
      await input.press('Enter');

      // wait on the real signal (the resend turn produced its reply → the resend
      // tool ran), not a fixed sleep; the idempotent backend must keep count at 1.
      await expect(page.getByTestId('answer-body'))
        .toHaveCount(answersBefore + 1, { timeout: 15_000 });
      expect(await countMailpitMessages(seed.request), 'no double-send').toBe(1);

      await ctx.close();
    });
});

// enterWithProfile — the ?code entry point → fill name + email in the name picker →
// submit → wait for the session.
async function enterWithProfile(
  page: Page, code: string, name: string, email?: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  if (email !== undefined) await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;
}

// bookInChat — script one calendar_book, trigger it → wait for the BookCard to appear.
async function bookInChat(page: Page, hour: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book')).toBeVisible({ timeout: 20_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  const seed = await seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  await configureMailConnector(seed.request, OWNER.email, OWNER.password);
  return seed;
}
