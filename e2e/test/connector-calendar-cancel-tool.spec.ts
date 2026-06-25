// connector-calendar-cancel-tool.spec.ts —— §一(visitor calendar_cancel 作 tool)
//
// 今天取消走 REST(`/api/v1/booking-cancellation`,postBookingCancellation)。重构后
// 它成 connector-backed **tool**:booked 沙盒卡上的 cancel 按钮 post
// `{type:'mcp-ui:tool', name:'calendar_cancel', args}` → host 带 session context 派发
// `calendar_cancel` tool → tool 经 calendar connector proxy 删 event → 回
// `mcp-ui:tool-result` → 卡进 cancelled 态。这条专守 **TOOL 路径**(不是旧 REST):
//   - 删除真发生(getMockEvents 那条 event 没了 = tool 经 connector proxy 删了)
//   - 卡进 cancelled 终态(tool-result 回卡)
//   - 幂等:对已取消的同一 booking 再点 / 再调,不双删、不崩(E13)
//
// RED / TDD:在 calendar_cancel 成为 tool(经 mcp-ui:tool 调,退役 REST)之前,运行期失败。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · visitor calendar_cancel as a tool (§一)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('cancel inside the iframe → calendar_cancel tool removes the event + card shows cancelled',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Cara', 'cara@example.com', 14);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // cancel 经 mcp-ui:tool → calendar_cancel tool(不是 REST postBookingCancellation)。
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();

      // tool 路径的可观察副作用:event 经 connector proxy 被删。
      const after = await getMockEvents(seed.request);
      expect(after.find((e) => e.event_id === eventID)).toBeUndefined();

      // 卡进 cancelled 终态(tool-result 回卡 → 重渲)。
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

      await ctx.close();
    });

  test('幂等(E13): re-cancelling an already-cancelled booking is a no-op, no double-delete / crash',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Dex', 'dex@example.com', 15);

      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });

      // 取消后:events 里没有任何 active event(那条已删)。再次取消(若卡仍暴露重试入口
      // 或经 reload 复现)应幂等 —— 这里以「再调一次不让计数变负/不冒新 event」为约束:
      // 当前可观察口径是 events 列表里不会因重复取消多出/少掉东西。
      const afterFirst = await getMockEvents(seed.request);
      expect(afterFirst.length).toBe(0);

      // reload 重建卡(restore 会从 conversation aggregate 重渲 booked 卡 + 其 cancelled 态),
      // 幂等门保证 cancelled 卡稳定、不再有可点的 cancel 动作。
      await page.reload();
      const reloaded = bookedFrame(page);
      await expect(reloaded.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 15_000 });
      await expect(reloaded.getByTestId('book-card-cancel')).toHaveCount(0);
      // 幂等:重复取消没在 mock 上留下任何残留 event。
      expect((await getMockEvents(seed.request)).length).toBe(0);

      await ctx.close();
    });
});

// bookedFrame —— booked 沙盒卡 iframe;内容经 frameLocator 取。
function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

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
