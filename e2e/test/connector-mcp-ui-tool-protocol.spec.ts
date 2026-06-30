// connector-mcp-ui-tool-protocol.spec.ts —— §一(mcp-ui:tool 协议)
//
// 新的 host 协议:沙盒卡 post `{type:'mcp-ui:tool', name, args}` → host 带 **session
// context** 派发那个具名 tool → 把 `{type:'mcp-ui:tool-result', ...}` post 回卡。
// 这条验整条 round-trip:卡发具名工具 → host 派发 → 结果回卡。沙盒跨 origin,
// postMessage 内部不可直接探针,所以用**可观察副作用**断言协议真的走通了:
//   - 卡上的动作(cancel)真触发了 tool(GCal event 被删 = calendar_cancel 跑了)
//   - tool-result 回卡后,卡进入对应终态(cancelled)= 卡收到了 result 并据此重渲
//
// 用 booked 卡驱动(它的 cancel/确认动作正是经 mcp-ui:tool 走的):book → iframe 卡 →
// 点 cancel → 断言 tool 的副作用发生(event 删 + 卡终态)。
//
// RED / TDD:在 mcp-ui:tool host 协议 + booked 卡经它调 calendar_cancel 落地前,
// 运行期失败。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { getMockEvents, resetMockGCal } from '@/fixtures/gcal';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('connector · mcp-ui:tool host protocol round-trip (§1)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('sandbox card posts mcp-ui:tool → host dispatches → tool runs (observable effect) → tool-result re-renders card',
    async ({ browser }) => {
      await resetMockGCal(seed.request);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterAndBook(page, seed.code.code, 'Pia', 'pia@example.com', 14);

      // book 落了一条真 GCal event(协议前置:卡里有可被 tool 作用的对象)。
      const before = await getMockEvents(seed.request);
      expect(before).toHaveLength(1);
      const eventID = before[0]!.event_id;

      // 卡上点 cancel → 卡 post {type:'mcp-ui:tool', name:'calendar_cancel', args}。
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();

      // round-trip 上行已通的可观察证据:host 带 session context 派发了 calendar_cancel,
      // tool 经 connector proxy 删了那条 event(副作用 = tool 真在 host 侧跑了,
      // 不是卡自己假装的)。
      await expect.poll(
        async () => (await getMockEvents(seed.request)).some((e) => e.event_id === eventID),
        { timeout: 10_000, message: 'calendar_cancel tool removed the event' },
      ).toBe(false);

      // round-trip 下行已通的可观察证据:host post 回 {type:'mcp-ui:tool-result'},
      // 卡据此重渲成 cancelled 终态(动作消失)。
      await expect(frame.getByTestId('tool-card-calendar_book'))
        .toHaveAttribute('data-cancelled', 'true', { timeout: 10_000 });
      await expect(frame.getByTestId('book-card-cancel')).toHaveCount(0);

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
