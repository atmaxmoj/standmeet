// visitor-chat-list-slots.spec.ts —— #124: calendar_list_slots 的结果渲成
// 一张「可收起的日历卡片」(react-day-picker 月历 + 选中日的时段 chips),
// 替换原来的 50 行平铺 list。确定性:mock LLM 脚本化一次 list_slots,owner 接
// mock gcal(空日历 → 有空档),浏览器里断言卡片结构 + 收起 + chip 点击落一条
// 预约 message。
//
// 用户故事:
//   1. code 访客进 chat
//   2. AI(mock)调 calendar_list_slots(未来窗口)→ 返回若干 30min 空档
//   3. SlotsCalendarCard 渲:<details open> + "available · N slots" + 月历格
//      + 选中日的时段 chips
//   4. 点 summary 收起;点一个 time chip → 新的 "you" turn 带 "book the … slot"

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('visitor chat · calendar_list_slots → collapsible calendar card (#124)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('renders calendar card + time chips; collapses; chip click books the slot',
    async ({ browser, playwright }) => {
      const req = await playwright.request.newContext();
      const tag = await scriptMockToolCall(req, {
        name: 'calendar_list_slots',
        // +3..+5 days clears the 1-day lead; mock FreeBusy is empty → slots
        // come back inside the 09:00–18:00 UTC working window.
        args: {
          from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
          duration_min: 30, step_min: 60,
        },
      });
      await req.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);
      await fireTurn(page, `what afternoons are open next week?${tag}`);

      // slots 卡(booker 插件 ui:// 沙盒 iframe)出现,内容经 frameLocator 取。
      await expect(page.getByTestId('mcp-app-card-calendar_list_slots'),
        'calendar card visible').toBeVisible({ timeout: 20_000 });
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_list_slots"]');
      const card = frame.getByTestId('tool-card-calendar_list_slots');
      // collapsible <details>, default-open
      await expect(card).toHaveJSProperty('open', true);
      await expect(frame.getByTestId('bookings-kicker')).toContainText('available ·');
      // public day picker rendered (day buttons grouped from the slots)
      await expect(frame.getByTestId('slot-calendar')).toBeVisible();
      await expect(frame.getByTestId('slot-day').first()).toBeVisible();
      // time chips for the selected day
      const chips = frame.getByTestId('tool-card-slot');
      await expect(chips.first()).toBeVisible();

      // wait for the turn to settle before toggling — list_slots isn't
      // return-directly, so a final answer streams after the card; interacting
      // mid-stream races the chat's re-renders.
      await expect(page.locator('[data-testid="answer-body"]').last())
        .toBeVisible({ timeout: 20_000 });

      // collapse + re-open works
      const summary = card.locator('summary').first();
      await summary.click();
      await expect(card).toHaveJSProperty('open', false);
      await summary.click();
      await expect(card).toHaveJSProperty('open', true);

      // clicking a chip fires a new turn carrying the booking phrasing
      await chips.first().click();
      const dialogs = page.locator(
        '[data-testid="conversation-deck"] article, [data-testid="chatroom"] article',
      );
      await expect(dialogs.last()).toContainText(/book the .* slot/i, { timeout: 5_000 });

      await ctx.close();
    });
});

// enterCodeSession 已 skip 名字选择器并等到 /sessions 200;不二次 dismiss
// (会采样到 picker unmount 窗口 → click 10s 超时,check-then-act race)。
async function enterChat(page: Page, code: string): Promise<void> {
  await enterCodeSession(page, code);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function fireTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
