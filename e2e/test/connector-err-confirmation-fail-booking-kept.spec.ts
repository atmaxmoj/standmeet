// connector-err-confirmation-fail-booking-kept.spec.ts —— §四 错误流矩阵 E11
// 多步 partial:booking 已 commit(event 落地)→ 之后**确认信发失败** → booking
// **保留**(getMockEvents 仍有那张 event)、卡显发送错误、**不回滚**、不崩。
// 跟 E8(connector-err-smtp-fail)同一类故障但侧重断「booking 不被回滚」这一保证:
// 即写库与发信是两步,后一步失败绝不撤前一步。
//
// Error stream E11: booking commits, then the confirmation email send fails →
// the booking is KEPT (the event still exists via getMockEvents), the card shows
// a send error, no rollback, no crash.
//
// RED / TDD：依赖 send_confirmation 把 SMTP 失败映射成卡内友好错误且**不回滚已 commit 的 booking** 落地后转绿。

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

test.describe('connector error stream · confirmation send fails but booking is kept (E11)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await resetSMTPFault(seed.request); await teardownSeed(seed); });

  test('booking commits → confirmation send fails → event kept, card shows error, no rollback, no crash',
    async ({ browser }) => {
      await clearMailpit(seed.request);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterWithProfile(page, seed.code.code, 'Dana', 'dana.profile@example.com');
      await bookInChat(page, 14);

      // booking committed first — the event exists BEFORE the send fault matters.
      const before = await getMockEvents(seed.request);
      expect(before.length, 'booking committed (event exists)').toBeGreaterThanOrEqual(1);

      // now arm the SMTP fault and trigger the confirmation send from the card.
      await armSMTPFault(seed.request, { mode: 'connection_refused', times: 1 });
      const frame = bookedFrame(page);
      const prompt = frame.getByTestId('booking-email-prompt');
      await expect(prompt).toBeVisible({ timeout: 10_000 });
      await frame.getByTestId('booking-email-use-profile').click();

      // card shows a friendly send error and stays un-sent.
      const err = frame.getByTestId('booking-email-error');
      await expect(err, 'friendly card error').toBeVisible({ timeout: 10_000 });
      const errText = (await err.textContent()) ?? '';
      expect(errText, 'no stack / raw smtp error')
        .not.toMatch(/panic|goroutine|stack|dial tcp|connection refused/i);
      await expect(prompt).toHaveAttribute('data-sent', 'false');

      // load-bearing: the booking was NOT rolled back by the send failure.
      const after = await getMockEvents(seed.request);
      expect(after.length, 'event still kept after send failure (no rollback)')
        .toBe(before.length);

      await ctx.close();
    });
});

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

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
