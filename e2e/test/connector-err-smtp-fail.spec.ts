// connector-err-smtp-fail.spec.ts —— §四 E8
// 约成后发确认信，mock SMTP 连接拒/认证失败/超时 → 卡内显示友好错误，booking 本身
// **不回滚**，无 stack 泄漏。Model on booking-confirmation-email（真 e2e:浏览器 → 卡 →
// 后端 → SMTP）。
//
// RED / TDD：依赖 send_confirmation 把 SMTP 失败映射成卡内友好错误（而非崩/裸错）落地。
//
// Error stream E8: when the SMTP send fails (connection refused / auth / timeout),
// the confirmation card shows a friendly error, the booking is NOT rolled back, and
// no stack trace leaks.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, armSMTPFault, resetSMTPFault,
} from '@/fixtures/mail';
import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

test.describe('connector error stream · SMTP send fails (E8 — booking not rolled back)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await resetSMTPFault(seed.request); await teardownSeed(seed); });

  test('confirmation send fails → card shows friendly error, booking kept, no stack',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      await armSMTPFault(seed.request, { mode: 'connection_refused' });

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 14);

      // booking succeeded first (the event exists) — SMTP failure must not roll it back.
      const events = await getMockEvents(seed.request);
      expect(events.length, 'booking committed despite send failure').toBeGreaterThanOrEqual(1);

      // visitor triggers the confirmation send → SMTP fails → friendly card error.
      const frame = bookedFrame(page);
      const prompt = frame.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });
      await frame.getByTestId('booking-email-use-profile').click();

      const err = frame.getByTestId('booking-email-error');
      await expect(err, 'friendly card error').toBeVisible({ timeout: 10_000 });
      const errText = (await err.textContent()) ?? '';
      expect(errText, 'no stack / raw smtp error')
        .not.toMatch(/panic|goroutine|stack|dial tcp|connection refused/i);
      // not marked sent — the send did not succeed.
      await expect(prompt).toHaveAttribute('data-sent', 'false');

      await ctx.close();
    });
});

// enterWithProfile —— ?code 入口 → 名字选择器填 name + email → 提交 → 等 session。
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

// bookInChat —— script 一次 calendar_book，触发 → 等 BookCard 出现。
async function bookInChat(page: Page, hour: number): Promise<void> {
  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
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
