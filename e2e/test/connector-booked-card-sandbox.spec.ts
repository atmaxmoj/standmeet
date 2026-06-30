// connector-booked-card-sandbox.spec.ts —— §一(booked-card 外置)
//
// 重构后:成功的 calendar_book 渲成 booker 插件 ui:// 服出的**沙盒 iframe 卡**
// (`mcp-app-card-calendar_book`),退役了最后一张写死的 React 卡
// (`tool-card-calendar_book`,`NON_SANDBOX_CARDS` 清空)。这条守的是「外置发生了」
// 这件事本身:book 成功 → 主 DOM 出 iframe、**不**出旧 React 卡;iframe 内容
// (booked 确认)经 frameLocator 取得到。
//
// RED / TDD:在 booked 卡真正变成 ui:// 沙盒 iframe 之前,这条运行期失败
// (旧 React 卡仍在主 DOM、没有 mcp-app-card-calendar_book iframe)。

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

      // 外置卡:外层 host 容器(iframe)在主 DOM 可见。
      const host = page.getByTestId('mcp-app-card-calendar_book');
      await expect(host, 'booked sandbox card host visible').toBeVisible({ timeout: 20_000 });
      // 它真是个 iframe(沙盒),不是普通 div。
      expect(await host.evaluate((el) => el.tagName.toLowerCase())).toBe('iframe');

      // 旧的写死 React 卡**不在主 DOM**(NON_SANDBOX_CARDS 已清空)。
      await expect(page.locator('body > * [data-testid="tool-card-calendar_book"]'))
        .toHaveCount(0);

      // iframe 内容(booked 确认)经 frameLocator 取得到 —— 证明渲染落在 sandbox 里。
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
      await expect(frame.getByTestId('book-card-time')).toBeVisible({ timeout: 10_000 });

      await ctx.close();
    });
});

// enterAndBook —— ?code 入口 → 名字+email → script 一次 calendar_book → 触发 →
// 等 booked 沙盒卡 iframe 出现。
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

  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
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
