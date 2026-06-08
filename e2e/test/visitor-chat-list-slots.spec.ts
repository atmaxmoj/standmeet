// visitor-chat-list-slots.spec.ts —— G-7: visitor 持 code 让 chat agent 调
// calendar_list_slots 查 owner 可订时间，frontend SlotsCard 渲列表 (visitor
// 不用瞎猜时间)。calendar_book 已在 chat-book-* 系列覆盖；这里只验 list
// 路径 + SlotsCard 渲染。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { setMockBusy } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { goto } from '@/fixtures/navigate';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

test.describe('chat · calendar_list_slots → SlotsCard', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('agent 调 calendar_list_slots → 卡显示 free slots (busy 时段被过滤)',
    async ({ browser }) => {
      const from = futureMidnight(7);
      const until = futureMidnight(8);
      const busyStart = futureHour(7, 14); // 2pm
      const busyEnd = futureHour(7, 16);   // 4pm

      // owner 那天 14:00-16:00 有事；剩余应该有可订 slot
      await setMockBusy(seed.request, [{ start: busyStart, end: busyEnd }]);
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
      await input.fill('What slots do you have next week?');
      await input.press('Enter');

      // SlotsCard 出现
      const card = page.getByTestId('tool-card-calendar_list_slots');
      await expect(card).toBeVisible({ timeout: 20_000 });

      // 至少一行 slot row (working hours - busy window 还有空闲)
      const rows = card.locator('[data-testid="tool-card-slot"]');
      await expect(rows.first()).toBeVisible();
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);

      // busy 区间内 slot 不在列表里 (start∈[14:00,16:00) 都被过滤)
      const busyStarts = await rows.evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-start') ?? ''),
      );
      const busyHit = busyStarts.some(
        (iso) => iso >= busyStart && iso < busyEnd,
      );
      expect(busyHit).toBe(false);

      await ctx.close();
    });
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}

// futureMidnight —— UTC `+days` 天后 00:00:00 (作 query 窗口边界用)。
function futureMidnight(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function futureHour(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
