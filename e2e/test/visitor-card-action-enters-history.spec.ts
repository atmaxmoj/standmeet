// visitor-card-action-enters-history.spec.ts —— F-B-9 ⭐⭐：**访客在卡上做的事，
// agent 下一轮必须知道。**
//
// prod 上连着两轮抓到的（2026-08-18）：我在回执卡上点了 `Cancel meeting`，卡翻成
// `CANCELLED`、时间划掉；下一轮请 AI 取消另一场，它答完顺口说
// *"Your Thursday, August 27 at 10:00 AM intro call is still on the books."*
// 同一屏上两句话互相矛盾，而其中一句是假的。
//
// 机制不用猜，两条路读得通（`use-mcp-app-card.ts:75` → `callVisitorTool` →
// `POST /sessions/{id}/tools/{name}`，见 `routes/public/tools.go`）：那个 handler 装配、
// 执行、返回，**从头到尾没有碰过 conversation**。而访客对话是**客户端驱动**的 ——
// 每一轮把自己手里那串消息当 History 发出去。卡片的调用不在那串里，所以对 agent 来说
// 它从没发生过。
//
// 判据落在**唯一看得见这件事的地方**：发给模型的那一份消息。不是断模型说了什么
// （那是概率的，见 [[faicheck-deterministic-llm-loop-bug]] 一族），是断这条事实
// **进没进它的上下文**。mock gateway 本来就留着每一趟请求的全文，只是以前没让人问；
// 现在 `?contains=` 让它答得出来。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Recruiter chat';

// CARD_EVENT_MARK —— 找的是**这条事件本身**，不是工具名。
//
// 第一版的 needle 是 `calendar_cancel`，而工具清单本来就在 system prompt 里 ——
// 那句断言在产品什么都不做的时候照样绿（[[assertion-that-cannot-fail]]）。
// 这个前缀只有 `cardEventText` 会写出来，所以它命中 = 这件事真的进了上下文。
const CARD_EVENT_MARK = '[card action]';

test.describe('F-B-9 · what the visitor does on a card reaches the next turn', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('cancelling on the card puts it in the history the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // 倒掉记录环：tag 每次跑都一样，而环跨 run 活着 —— 不清的话这条判据会命中
      // **上一次跑**留下的那条记录，从此判不了负（我在这条上真撞见过一次假绿）。
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      // 1) 先真订一场 —— 卡是这条缺陷的现场，没有卡就没有可点的取消。
      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, 14)] },
      });
      await ask(page, `book me a 30-minute chat next week, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booked card is the surface this defect lives on')
        .toBeVisible({ timeout: 30_000 });

      // 2) 在卡上点取消 —— 走 mcp-ui:tool 那条路，不经过对话。
      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'),
        'the card itself knows: it flips to cancelled')
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });

      // 3) 再问一句 —— 这一轮发出去的 History 里应该带着「卡上取消了」。
      const nextTag = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `is anything still on the books?${nextTag}`);

      const req = await expect.poll(
        async () => (await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK)).found,
        { timeout: 30_000, message: 'the next turn actually reached the model' },
      ).toBe(true).then(() => lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK));

      expect(req.contains,
        'the cancellation the visitor made on the card is in the context this turn was sent with '
        + '— otherwise the agent answers about a meeting that no longer exists')
        .toBe(true);

      await ctx.close();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function bookedFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-calendar_book"]');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Rachel');
  await page.getByTestId('visitor-email-input').fill('rachel@example.com');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
