// connector-err-owner-notify-fail-no-rollback.spec.ts —— §四 E10
// booking 成功，但约成后给 owner 的通知邮件失败 → booking 仍 commit（event 经
// getMockEvents 可见），访客仍拿到 success；notify 失败**不**回滚/不报错 booking。
// Model on booking-owner-notify。
//
// RED / TDD：依赖 owner-notify 走 best-effort（失败吞掉、不堵 booking）落地。
//
// Error stream E10 (partial failure): owner-notify email fails, but the booking
// still commits — the event exists, the visitor still sees success, and the notify
// failure does NOT roll back or error the booking.

import { test, expect } from '@/fixtures/test';
import type { Browser, FrameLocator, Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, countMailpitMessages, armSMTPFault, resetSMTPFault,
} from '@/fixtures/mail';
import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { login } from '@/fixtures/admin';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

test.describe('connector error stream · owner-notify fails, booking not rolled back (E10)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await resetSMTPFault(seed.request); await teardownSeed(seed); });

  test('notify-on role + SMTP fails → booking commits, visitor sees success, no crash',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      // role that notifies owner on booking.
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], notify_owner_on_booking: true,
      });
      // make the (owner-notify) send fail.
      await armSMTPFault(seed.request, { mode: 'connection_refused' });

      const page = await enterAndBook(browser, code.code, 'Dana', 14);

      // booking still succeeded (visitor sees the booked card).
      await expect(bookedFrame(page).getByTestId('book-card-time')).toBeVisible();
      // and the event was actually committed to the calendar.
      const events = await getMockEvents(seed.request);
      expect(events.length, 'booking committed despite notify failure').toBeGreaterThanOrEqual(1);
      // owner-notify failed → no owner email landed, but that's silent (no rollback).
      expect(await countMailpitMessages(seed.request)).toBe(0);

      await page.context().close();
    });
});

// enterAndBook —— ?code 入口 → 填名字 → script calendar_book → 触发 → 等 BookCard。
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

  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
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

async function prep(playwright: Playwright): Promise<CodedSeed> {
  const seed = await seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'], max_bookings: 9,
  });
  await configureMailConnector(seed.request, OWNER.email, OWNER.password);
  // configureMailConnector 内部重新 login，轮换 CSRF —— 刷新 seed.csrf，否则
  // 后面 issueCodeWithSkills 拿旧 token 会 403。
  seed.csrf = (await login(seed.request, OWNER.email, OWNER.password)).csrf;
  return seed;
}
