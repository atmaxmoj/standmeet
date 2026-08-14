// visitor-same-name-continue.spec.ts —— 换人窗口里用「同一个名字」START,必须
// 续聊:既不清空 transcript、也不把 turn 计数归零。
//
// 后端本来就对:resolveMemberWithQuota 同名 → 同 member,createCodeConversation
// 走 GetOpenChatByMember → 续上该 member 的 open chat,turn 限额按 conversation
// 数(CountVisitorTurns)算,都在。bug 纯前端:同名也照样 re-issue,触发
// startedAt-reset 清掉 dialogs + issue 响应里 UsedTurns 恒 0 → 看着像重置。
//
// 期望:同名 START → 直接关窗续聊,上一条问答还在、turn 计数不变。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const NAME = 'Dana';
// 第二条测试用不同名字 = 不同 member = 干净的会话,避免 #11 history-restore 把
// 第一条测试(Dana)的同句问话带回来,让 getByText 撞到 2 个。
const NAME2 = 'Eve';
const QUESTION = 'tell me about lucerna';

test.describe('换人窗口同名 START 续聊,不清空不重置', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'same-name-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('同名 reopen + START → 上一条问答还在 + turn 计数不归零',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE, NAME);

      // #28: backend 落库在 /agent/turn 流末端(`done` 之前);res.finished()
      // = 流读完 = 已落库。
      const turnDone = page.waitForResponse((r) =>
        r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(QUESTION);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await (await turnDone).finished();

      const usedSel = '[data-testid="session-strip-turns-used"]';
      const usedBefore = await page.locator(usedSel).innerText();
      expect(usedBefore).not.toBe('0'); // 问过一句,计数应 ≥ 1

      // 点 "you · Dana" 重开名字选择器,名字不变直接 START。
      await page.getByTestId('session-strip-switch-name').click();
      await expect(page.getByTestId('visitor-name-input')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('visitor-name-submit').click();

      // 窗关了 → 续聊:上一条问答还在,turn 计数没归零。
      await expect(page.getByTestId('visitor-name-input')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText(QUESTION)).toBeVisible();
      expect(await page.locator(usedSel).innerText()).toBe(usedBefore);

      await ctx.close();
    });

  test('换人窗口点窗外 backdrop → 关窗续聊,不清空',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE, NAME2);

      // #28: backend 落库在 /agent/turn 流末端(`done` 之前);res.finished()
      // = 流读完 = 已落库。
      const turnDone = page.waitForResponse((r) =>
        r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(QUESTION);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await (await turnDone).finished();

      // 重开名字选择器 → 点窗外角落(backdrop,非 card)→ 应关窗、保持原会话。
      await page.getByTestId('session-strip-switch-name').click();
      await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('visitor-name-overlay').click({ position: { x: 5, y: 5 } });

      await expect(page.getByTestId('visitor-name-input')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText(QUESTION)).toBeVisible();

      await ctx.close();
    });
});
