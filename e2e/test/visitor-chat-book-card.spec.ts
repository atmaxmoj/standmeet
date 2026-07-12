// visitor-chat-book-card.spec.ts —— calendar_book 成功后渲一张「已约确认卡」。
//
// 重构后(connector deps,§二):booked 卡是 booker 插件 ui:// 服出的沙盒 iframe
// (`mcp-app-card-calendar_book`),不再是主 DOM 里写死的 React 卡
// (`tool-card-calendar_book`,`NON_SANDBOX_CARDS` 已清空)。卡的内容(time + GCal
// 链接 + cancel/确认 widget)在 iframe 内,经 frameLocator 取。
//
// 这条守的是**卡的渲染契约**:book 成功 → iframe 卡出现 → 含 time + 指向真实 GCal
// 事件的链接。cancel / send_confirmation 的行为分别由 visitor-cancel-booking /
// booking-confirmation-email 覆盖。
//
// 流程:
//   1. seed code 带 calendar.book + max_bookings
//   2. scripted mock 调 calendar_book → booked 沙盒卡 iframe 出现
//   3. frameLocator 进 iframe 断言 book-card-time + book-card-link(href → calendar.google)

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const MAX_BOOKINGS = 3;
const TOPIC = 'Recruiter chat';

test.describe('chat · booked card renders as mcp-app-card iframe', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book 成功 → mcp-app-card-calendar_book iframe 出现,内含 time + GCal 链接',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code, 'Rachel', 'rachel@example.com');

      // scripted calendar_book(+7 天已知工作日,working hours 内的固定小时)。
      const tag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, 14)] },
      });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`book me a 30-minute chat next week, please${tag}`);
      await input.press('Enter');

      // booked 卡是沙盒 iframe:外层 testid 在主 DOM 可见,内容经 frameLocator 取
      // (不再是主 DOM 里的 React tool-card-calendar_book)。
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'booked card iframe visible').toBeVisible({ timeout: 20_000 });
      const frame = bookedFrame(page);
      // 卡内的「已约」确认:time + 指向真实 GCal 事件的链接。
      await expect(frame.getByTestId('book-card-time')).toBeVisible();
      await expect(frame.getByTestId('book-card-link'))
        .toHaveAttribute('href', /calendar\.google/);

      await ctx.close();
    });
});

// bookedFrame —— 已外置的 booked 卡是个沙盒 iframe;内容经 frameLocator 取。
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

// enterChat —— ?code 入口 → 名字选择器填 name + email → 提交 → 等 session → chatroom 就绪。
async function enterChat(
  page: Page, code: string, name: string, email: string,
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
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
    max_bookings: MAX_BOOKINGS,
  });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
