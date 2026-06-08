// visitor-chat-book-card.spec.ts —— G-7 follow-up: calendar_book 成功后
// BookCard 渲 confirmation (time + GCal 链接) + SlotsCard kicker 显示
// 当前剩余 booking 配额。
//
// 流程：
//   1. seed code 带 max_bookings = 3
//   2. scripted mock 调 calendar_list_slots → SlotsCard 出现，kicker 显
//      "3 bookings left"
//   3. scripted mock 接调 calendar_book → BookCard 出现，含 time + 链接

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { goto } from '@/fixtures/navigate';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const MAX_BOOKINGS = 3;

test.describe('chat · BookCard + bookings-remaining badge', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('list_slots 卡 kicker 显示 3 bookings left；book 后 BookCard 出现 confirmation',
    async ({ browser }) => {
      const from = futureMidnight(7);
      const until = futureMidnight(8);

      // 第一步：scripted list_slots
      await scriptMockToolCall(seed.request, {
        name: 'calendar_list_slots',
        args: {
          from_rfc3339: from, until_rfc3339: until,
          duration_min: 30, step_min: 60,
        },
      });

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await goto(page, `/?code=${seed.code.code}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('what times do you have?');
      await input.press('Enter');

      // SlotsCard + kicker 显示剩余 booking 数
      const slotsCard = page.getByTestId('tool-card-calendar_list_slots');
      await expect(slotsCard).toBeVisible({ timeout: 20_000 });
      await expect(slotsCard.getByTestId('bookings-remaining'))
        .toContainText(`${MAX_BOOKINGS} bookings left`);

      // 第二步：scripted calendar_book
      const firstSlotStart = await slotsCard
        .locator('[data-testid="tool-card-slot"]').first()
        .getAttribute('data-start');
      expect(firstSlotStart).not.toBeNull();
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: {
          topic: 'Recruiter chat',
          duration_min: 30,
          preferred_times: [firstSlotStart],
        },
      });
      await expect(input).toBeEnabled({ timeout: 20_000 });
      await input.fill(`book me at ${firstSlotStart}`);
      await input.press('Enter');

      // BookCard 出现 + 含 GCal 链接
      const bookCard = page.getByTestId('tool-card-calendar_book');
      await expect(bookCard).toBeVisible({ timeout: 20_000 });
      await expect(bookCard.getByTestId('book-card-time')).toBeVisible();
      await expect(bookCard.getByTestId('book-card-link'))
        .toHaveAttribute('href', /calendar\.google/);

      await ctx.close();
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: MAX_BOOKINGS,
  });
}

function futureMidnight(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
