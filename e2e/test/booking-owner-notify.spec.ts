// booking-owner-notify.spec.ts -- #130: per-role "notify owner on booking". The owner
// flips a switch on the role; when it's on, as soon as a visitor books under this code,
// the owner **automatically** gets an owner-perspective notification email (not the
// visitor-facing #122 confirmation -- that one goes to the visitor). The AI is not
// involved; the backend triggers this deterministically after the booking commits. No
// mail connector configured -> silently skipped (no error, doesn't block the booking).
//
// Real e2e: browser books -> backend -> owner SMTP (Mailpit).

import { test, expect } from '@/fixtures/test';
import type { Browser, FrameLocator, Page } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
  countMailpitMessages, MAIL_FROM,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { login } from '@/fixtures/admin';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

// The booked card has been externalized to the booker plugin's ui:// sandbox iframe; its
// content is read through frameLocator.
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

test.describe('booking · per-role owner notification (#130)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    // configureMailConnector logs in again internally, which rotates the CSRF token --
    // refresh seed.csrf, otherwise issueCodeWithSkills below would 403 on the stale token.
    seed.csrf = (await login(seed.request, OWNER.email, OWNER.password)).csrf;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('role with notify on → owner gets an owner-perspective email when a visitor books',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], notify_owner: true,
      });
      const page = await enterAndBook(browser, code.code, 'Dana', 14);

      const mail = await waitForMailEnvelopeTo(seed.request, OWNER.email);
      expect(mail.from).toBe(MAIL_FROM);
      expect(mail.text).toContain(TOPIC);
      expect(mail.text).toContain('Dana'); // owner sees who booked
      await page.context().close();
    });

  test('role with notify off (default) → no owner email, booking still succeeds',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], // notify_owner defaults to false
      });
      const page = await enterAndBook(browser, code.code, 'Eli', 15);

      // The booked card still appears as usual (the booking succeeded), but the owner
      // should not receive a notification.
      // The book-card appearing means the booker tool already returned. owner-notify now
      // runs async in the background, but with OFF/no connector it **sends no mail at
      // all** (there's nothing to send), so the count is always 0 and there's no need to
      // wait for the background job.
      await expect(bookedFrame(page).getByTestId('book-card-time')).toBeVisible();
      expect(await countMailpitMessages(seed.request)).toBe(0);
      await page.context().close();
    });
});

// notify on, but the owner has **not configured** a mail connector -> no way to send
// mail, best-effort silently skips it: the booking still succeeds, no crash, no block.
// This is #130's guarantee that "a notification failure never affects the booking".
test.describe('booking · owner notify on but no mail connector (#130 best-effort)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    // Note: this deliberately **does not** call configureMailConnector -- the owner has
    // no ability to send mail.
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('notify-on role + no connector → booking succeeds, no email, no crash',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], notify_owner: true,
      });
      const page = await enterAndBook(browser, code.code, 'Dana', 14);

      // The book-card appearing means the booker tool already returned. owner-notify now
      // runs async in the background, but with OFF/no connector it **sends no mail at
      // all** (there's nothing to send), so the count is always 0 and there's no need to
      // wait for the background job.
      await expect(bookedFrame(page).getByTestId('book-card-time')).toBeVisible();
      expect(await countMailpitMessages(seed.request)).toBe(0);
      await page.context().close();
    });
});

// enterAndBook -- ?code entry -> fills in a name -> scripts calendar_book -> triggers it
// -> waits for BookCard.
async function enterAndBook(
  browser: Browser, code: string, name: string, hour: number,
): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
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
  return page;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
