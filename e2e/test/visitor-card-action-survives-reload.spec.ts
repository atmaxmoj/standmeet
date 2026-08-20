// visitor-card-action-survives-reload.spec.ts —— F-B-9 的**持久化那一半**。
//
// 姊妹用例（`visitor-card-action-enters-history.spec.ts`）证的是「点完卡，下一轮模型知道」。
// 那一半只活在客户端手里那串消息里 —— 访客刷新一次页面，它就没了：屏幕上的卡还写着
// `CANCELLED`（逐字稿是从后端重建的），而模型的上下文里那件事从没发生过。同一屏上
// 两句互相矛盾的话，正是这条缺陷本来的形状。
//
// 所以这条判据只多做一件事：**在两轮之间刷新一次**。它红的时候说的是「这件事没落库」，
// 绿的时候说的是「这件事是后端发回来的，不是客户端还记得」。
//
// 判据仍落在唯一看得见的地方：发给模型的那一份消息（[[test-covers-capability-not-face]]）。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Reload recruiter chat';

// CARD_EVENT_MARK —— 只有卡上那条事件会写出这个前缀。用工具名当 needle 判不了负：
// 工具清单本来就在 system prompt 里（[[assertion-that-cannot-fail]]）。
const CARD_EVENT_MARK = '[card action]';

test.describe('F-B-9 · a card action outlives the page', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 3,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('after a reload the cancellation is still in what the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // 倒掉记录环：tag 每次跑都一样而环跨 run 活着，不清就会命中上一次跑留下的那条。
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      const bookTag = await scriptMockToolCall(page.request, {
        name: 'calendar_book',
        args: { topic: TOPIC, duration_min: 30, preferred_times: [future(9, 15)] },
      });
      await ask(page, `book me a 30-minute chat, please${bookTag}`);
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'the booked card is the surface this defect lives on')
        .toBeVisible({ timeout: 30_000 });

      const frame = bookedFrame(page);
      await frame.getByTestId('book-card-cancel').click();
      await expect(frame.getByTestId('tool-card-calendar_book'),
        'the card itself knows: it flips to cancelled')
        .toHaveAttribute('data-cancelled', 'true', { timeout: 30_000 });

      // 刷新 —— 客户端那串消息在这里被清空重建，事件只能从后端回来。
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 15_000 });
      // 先证会话确实恢复了，否则下面那句红了分不清是「事件没落库」还是「整段会话没回来」
      // （[[two-guards-dying-at-one-line]]）。
      await expect(page.locator('[data-testid="answer-body"]').first(),
        'the transcript comes back on screen')
        .toBeVisible({ timeout: 30_000 });

      const nextTag = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `is anything still on the books?${nextTag}`);

      await expect.poll(
        async () => (await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK)).found,
        { timeout: 30_000, message: 'the turn after the reload reached the model' },
      ).toBe(true);
      const req = await lastGatewayRequest(page.request, nextTag, CARD_EVENT_MARK);

      expect(req.contains,
        'the cancellation survived the reload — it came back from the server, not from a tab '
        + 'that happened to stay open')
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
  await page.getByTestId('visitor-name-input').fill('Reload Robin');
  await page.getByTestId('visitor-email-input').fill('robin@example.com');
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
