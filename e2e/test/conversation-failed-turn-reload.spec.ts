// conversation-failed-turn-reload.spec.ts — the reload-side boundary of "a dialog
// persists iff the AI finished answering".
//
// A failed / unfinished turn: the frontend renders a friendly error, but **never
// persists a dialog and never counts it**. After a reload it should be completely
// gone (absent from the transcript, count unchanged) — because the conversation
// aggregate is made up only of "turns that finished answering", count = len(dialogs).
//
// Uses a mock script to inject a failure (scriptMockError), deterministically
// reproducing a failed turn.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockError, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'FAILRELOAD-001';
const NAME = 'Fred';
const GOOD_Q = 'tell me about lucerna';
const FAIL_Q = 'this turn fails upstream';
const THIRD_Q = 'and what else have you built';
// The turn-count cell's own testid: the name-count cell uses the same class name, so
// selecting by class would hit both elements at once.
const USED = '[data-testid="session-strip-turns-used"]';

test.describe('失败的一轮不进 conversation,刷新后不在也不计数', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'fail-reload-seed');
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

  test('成功 + 失败 + 成功 → 刷新 → 失败那条不在,只剩两条答完的,count=2', async ({ page, request }) => {
    await enterCodeSession(page, CODE, NAME);
    const used = page.locator(USED);
    const answers = page.getByTestId('answer-body');
    const input = page.getByTestId('chat-input-field');
    await expect(used).toHaveText('0', { timeout: 10_000 });

    // 1) A successful turn → persists one dialog, count 1.
    await sendOk(page, request, input, GOOD_Q);
    await expect(used).toHaveText('1', { timeout: 10_000 });

    // 2) Inject a failing turn → a friendly error renders, but no dialog is persisted
    //    and count does not increase.
    const errTag = await scriptMockError(request);
    await input.fill(`${FAIL_Q}${errTag}`);
    await input.press('Enter');
    await expect(answers).toHaveCount(2, { timeout: 20_000 });
    await expect(used).toHaveText('1', { timeout: 10_000 });

    // 3) One more successful turn (which also resets the mock, so it doesn't leak
    //    into later specs) → count 2.
    await sendOk(page, request, input, THIRD_Q);
    await expect(used).toHaveText('2', { timeout: 10_000 });

    // 4) Reload → the conversation aggregate is made up only of "turns that finished
    //    answering": the failed one is completely gone, only two remain, count 2.
    await page.reload();
    await expect(page.getByText(GOOD_Q)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(THIRD_Q)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(FAIL_Q)).toHaveCount(0);
    await expect(answers).toHaveCount(2, { timeout: 10_000 });
    await expect(used).toHaveText('2', { timeout: 10_000 });
  });
});

// sendOk — script a normal answer (which also clears failAll), ask it, and wait for
// this turn to be persisted to the DB.
// #28: the backend persists at the end of the /agent/turn stream (before `done`);
// res.finished() = the stream finished reading = already persisted.
async function sendOk(
  page: Page, request: APIRequestContext,
  input: ReturnType<Page['getByTestId']>, q: string,
): Promise<void> {
  const turnDone = page.waitForResponse((r) =>
    r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
  const tag = await scriptMockReplyText(request, 'A real, grounded answer.');
  await input.fill(`${q}${tag}`);
  await input.press('Enter');
  await (await turnDone).finished();
}
