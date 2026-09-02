// visitor-same-name-continue.spec.ts -- pressing START with "the same name"
// in the switch-name modal must continue the conversation: it must not clear
// the transcript, and must not reset the turn count to zero.
//
// The backend was already correct here: resolveMemberWithQuota resolves the
// same name to the same member, and createCodeConversation goes through
// GetOpenChatByMember to resume that member's open chat; the turn quota is
// counted by conversation (CountVisitorTurns), and all of that already
// worked. The bug was purely frontend: even a same-name submission
// re-issued, which triggered a startedAt-reset that cleared the dialogs, and
// the issue response's UsedTurns was always 0 -- making it look reset.
//
// Expected: START with the same name -> closes the modal and continues the
// conversation, with the previous Q&A still there and the turn count unchanged.

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
// The second test uses a different name = a different member = a clean
// session, avoiding #11 history-restore bringing back the first test's
// (Dana's) same question, which would make getByText hit 2 matches.
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

      // #28: the backend writes to the DB at the end of the /agent/turn
      // stream (right before `done`); res.finished() = the stream is fully
      // read = it has been written.
      const turnDone = page.waitForResponse((r) =>
        r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(QUESTION);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await (await turnDone).finished();

      const usedSel = '[data-testid="session-strip-turns-used"]';
      const usedBefore = await page.locator(usedSel).innerText();
      expect(usedBefore).not.toBe('0'); // one question was asked, count should be >= 1

      // Click "you · Dana" to reopen the name picker, and submit START with
      // the name unchanged.
      await page.getByTestId('session-strip-switch-name').click();
      await expect(page.getByTestId('visitor-name-input')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('visitor-name-submit').click();

      // Modal closed -> continued: the previous Q&A is still there, and the
      // turn count wasn't reset.
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

      // #28: the backend writes to the DB at the end of the /agent/turn
      // stream (right before `done`); res.finished() = the stream is fully
      // read = it has been written.
      const turnDone = page.waitForResponse((r) =>
        r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(QUESTION);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await (await turnDone).finished();

      // Reopen the name picker -> click a corner outside the modal
      // (the backdrop, not the card) -> should close the modal and keep the
      // original session.
      await page.getByTestId('session-strip-switch-name').click();
      await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('visitor-name-overlay').click({ position: { x: 5, y: 5 } });

      await expect(page.getByTestId('visitor-name-input')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText(QUESTION)).toBeVisible();

      await ctx.close();
    });
});
