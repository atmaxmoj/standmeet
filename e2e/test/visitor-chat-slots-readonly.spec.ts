// visitor-chat-slots-readonly.spec.ts —— F-B-10：**只读授权下，时段卡不是一个订会入口。**
//
// 这条缺陷是在 F-B-8 的 ⑤ 上撞出来的。授权收窄成 `calendar.readonly` 之后，`calendar_book`
// 确实不进工具表了（38→34，prod 日志为证），可访客那一屏几乎没变：卡照旧摆着一排可点的
// chip，AI 照旧说 *"Tap the 9:00 AM slot on the card and it'll lock in the booking"*。
// 第一版修法（把订会的说明从能力级 instructions 里拿掉）**不够** —— 再驱一遍还是那句话。
// 承诺的落点在**卡本身**：卡挂在 `calendar_list_slots` 上，而那把工具在只读授权下是在场的，
// 每颗 chip 点下去 postMessage 一句「book the … slot」，那句话在这种授权下永远走不到订会。
//
// 现在这一格的事实由宿主回答（`connector.invoke can_perform events.insert`），插件把它当
// `can_book` 放进结果，卡据此决定给不给入口 —— 跟已约卡按 `can_email` 决定要不要渲确认信
// widget 是同一条规矩：**做不到的动作不给入口**。
//
// 两句断言缺一不可。只断「没有可点的 chip」的话，卡整个不渲染也能过 —— 而那是把一个
// **做得到**的事（看 owner 什么时候有空）也拿掉了，是另一个缺陷。

import { test, expect } from '@/fixtures/test';

import { GCAL_SCOPE_READ } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('F-B-10 · a read-only grant makes the slot card read-only', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], scopes: [GCAL_SCOPE_READ],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the times still show, and none of them is a booking button',
    async ({ browser, playwright }) => {
      test.setTimeout(120_000);
      const req = await playwright.request.newContext();
      const tag = await scriptMockToolCall(req, {
        name: 'calendar_list_slots',
        args: {
          from_rfc3339: future(3, 13), until_rfc3339: future(5, 23),
          duration_min: 30, step_min: 60,
        },
      });
      await req.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, seed.code.code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`what afternoons are open next week?${tag}`);
      await input.press('Enter');

      await expect(page.getByTestId('mcp-app-card-calendar_list_slots'),
        'the card still renders — reading free/busy is something this grant CAN do')
        .toBeVisible({ timeout: 20_000 });
      const frame = page.frameLocator('[data-testid="mcp-app-card-calendar_list_slots"]');

      // 先证卡真的渲出来了（不然下面那句「没有可点的 chip」是一句永远成立的空话）。
      await expect(frame.getByTestId('tool-card-slot-readonly').first(),
        'the owner\'s free times are shown, as plain times')
        .toBeVisible({ timeout: 10_000 });
      await expect(frame.getByTestId('slots-readonly-note'),
        'and the card says why there is nothing to tap')
        .toBeVisible();

      await expect(frame.getByTestId('tool-card-slot'),
        'no chip is a booking button: this grant cannot write an event, and a tap that '
        + 'leads nowhere is the defect')
        .toHaveCount(0);

      await ctx.close();
    });
});

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
