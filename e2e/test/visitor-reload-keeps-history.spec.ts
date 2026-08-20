// visitor-reload-keeps-history.spec.ts —— 访客刷新一次之后，**屏幕上还在的那些话，
// 模型还看得见吗**。
//
// 为什么问这个：F-B-9 的持久化那一半正卡在这儿。卡上的事件要「刷新之后还在」，前提是
// 刷新之后**整段历史**还在。而这段对话是客户端驱动的（`use-chat.ts` 攥着 `messageHistRef`，
// 每轮把它当 History 发出去），刷新时 `restoreSession` 只重建**逐字稿**（`setDialogs`）——
// 读代码看不出它有没有同时把那串消息补回来，所以在这儿真跑一次问出来。
//
// 判据落在唯一看得见的地方：**发给模型的那一份消息**。屏幕上有那句话不算数 ——
// 那正是这一族缺陷的形状（[[test-covers-capability-not-face]]）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText,
} from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

// MEMORABLE —— 第一轮里一句只属于这条 spec 的话。第二轮的请求里找它。
const MEMORABLE = 'pineapple-lighthouse-42';

test.describe('a reload keeps the conversation the model can see', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: [] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('after refreshing, the earlier turn is still in what the next turn sends',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await resetGatewayRequests(page.request);
      await enterChat(page, seed.code.code);

      const first = await scriptMockReplyText(page.request, 'noted');
      await ask(page, `Remember this word: ${MEMORABLE}${first}`);
      await expect(page.locator('[data-testid="answer-body"]').last())
        .toBeVisible({ timeout: 30_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 15_000 });
      // 逐字稿确实回来了 —— 先证这一半，否则下面那句红了也分不清是「历史丢了」
      // 还是「刷新之后整个会话没恢复」。
      await expect(page.locator('[data-testid="answer-body"]').first(),
        'the transcript comes back on screen')
        .toBeVisible({ timeout: 30_000 });

      const second = await scriptMockReplyText(page.request, 'still noted');
      await ask(page, `What was the word?${second}`);

      await expect.poll(
        async () => (await lastGatewayRequest(page.request, second, MEMORABLE)).found,
        { timeout: 30_000, message: 'the second turn reached the model' },
      ).toBe(true);
      const req = await lastGatewayRequest(page.request, second, MEMORABLE);

      expect(req.contains,
        'the first turn is still in the context — the visitor can see it on screen, so an answer '
        + 'that has forgotten it is the product contradicting its own transcript')
        .toBe(true);

      await ctx.close();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function enterChat(page: Page, code: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Reload Rachel');
  await page.getByTestId('visitor-name-submit').click();
  await session;
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}
