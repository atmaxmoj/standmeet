// booking-invite-truth.spec.ts -- F-B-6. The booking receipt must **say who the invite went
// to**, including "nobody".
//
// What happened in the real environment: the visitor left "email (optional, for meeting
// invites)" blank in the identity modal, and the booking still went through; the chat then
// said *"The calendar invite will go to sijie.wang.lark@gmail.com. See you then."*
// -- that address was text the visitor had typed **in the chat body**. The real inbox was
// empty; on Google, that event had zero attendees.
//
// The mechanism is not "the model made it up" -- it simply has no field it can check itself
// against:
//   - `book.go:53`'s `VisitorEmail` carries `omitempty` -- when no email was collected, the
//     field disappears entirely, and the receipt becomes
//     `{ok, event_id, html_link, start, end, can_email:true}`;
//   - `can_email` is `ownerCanEmail(ownerID)`, which says **whether it's possible** to send
//     mail, not **whether one was sent**;
//   - and `content.go:19`'s system-prompt fragment tells the model "the calendar invite goes
//     to the email the visitor entered when they arrived (if they gave one)".
// With the "was one given" field missing, the model fills it in from the conversation --
// an omitted field is not the same as null ([[empty-is-not-json-null]]).
//
// The assertion lives on **the card the visitor actually sees**, not on the wire: the card
// is the receipt the visitor keeps (the chat body will scroll away), and the harm of this
// bug is precisely "the receipt states something that never happened".

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const GUEST_EMAIL = 'wanda.guest@example.com';

test.describe('F-B-6 · the booking receipt says who was invited', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('visitor gave no email → the card says plainly that no invite went out',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wanda', '');
      await bookOnce(page, 7);

      const line = bookedFrame(page).getByTestId('book-card-invite');
      // The assertion is "it says nobody was invited", not "it said nothing wrong" -- staying
      // silent is exactly this bug.
      await expect(line, 'the receipt states that nobody was invited')
        .toBeVisible({ timeout: 20_000 });
      await expect(line).toContainText(/no invite|not emailed|nobody/i);
      await ctx.close();
    });

  test('visitor gave an email → the card names that address',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Wendy', GUEST_EMAIL);
      await bookOnce(page, 8);

      await expect(bookedFrame(page).getByTestId('book-card-invite'),
        'the receipt names the address the invite went to')
        .toContainText(GUEST_EMAIL, { timeout: 20_000 });
      await ctx.close();
    });
});

// bookOnce -- fires one scripted calendar_book (within business hours, +days days out), then
// waits for the card.
async function bookOnce(page: Page, days: number): Promise<void> {
  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: 'Intro call', duration_min: 30, preferred_times: [future(days, 14)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat${tag}`);
  await input.press('Enter');
  await expect(page.getByTestId('mcp-app-card-calendar_book'),
    'booked card iframe visible').toBeVisible({ timeout: 20_000 });
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterChat -- ?code entry -> fill name in identity modal (empty email skips that optional
// field) -> wait for session.
async function enterChat(
  page: Page, code: string, name: string, email: string,
): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  if (email !== '') await page.getByTestId('visitor-email-input').fill(email);
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: 3,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
