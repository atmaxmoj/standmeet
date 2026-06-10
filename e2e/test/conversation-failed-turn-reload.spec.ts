// conversation-failed-turn-reload.spec.ts —— 「dialog 持久化 iff AI 答完」的
// 刷新版边界。
//
// 失败/没答完的一轮:前端会渲一条友好错误,但**不落 dialog、不计数**。刷新后
// 这条就该彻底不在(transcript 里没有、count 没涨)——因为 conversation 聚合只
// 由"答完的轮"组成,count = len(dialogs)。
//
// 用 mock 脚本注入故障(scriptMockError),确定性复现失败一轮。

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
const USED = '.sm-session-strip-used';

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

    // 1) 成功一轮 → 落一条 dialog,count 1。
    await sendOk(page, request, input, GOOD_Q);
    await expect(used).toHaveText('1', { timeout: 10_000 });

    // 2) 注入故障一轮 → 渲友好错误,但不落 dialog、count 不涨。
    await scriptMockError(request);
    await input.fill(FAIL_Q);
    await input.press('Enter');
    await expect(answers).toHaveCount(2, { timeout: 20_000 });
    await expect(used).toHaveText('1', { timeout: 10_000 });

    // 3) 再成功一轮(同时把 mock 复位,不污染后续 spec)→ count 2。
    await sendOk(page, request, input, THIRD_Q);
    await expect(used).toHaveText('2', { timeout: 10_000 });

    // 4) 刷新 → conversation 聚合只由"答完的轮"组成:失败那条彻底不在,只剩两条,count 2。
    await page.reload();
    await expect(page.getByText(GOOD_Q)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(THIRD_Q)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(FAIL_Q)).toHaveCount(0);
    await expect(answers).toHaveCount(2, { timeout: 10_000 });
    await expect(used).toHaveText('2', { timeout: 10_000 });
  });
});

// sendOk —— 脚本一条正常回答(顺带清掉 failAll),问出去,等 /dialogs 落库。
async function sendOk(
  page: Page, request: APIRequestContext,
  input: ReturnType<Page['getByTestId']>, q: string,
): Promise<void> {
  const recorded = page.waitForResponse((r) =>
    r.url().includes('/dialogs') && r.status() === 204, { timeout: 20_000 });
  await scriptMockReplyText(request, 'A real, grounded answer.');
  await input.fill(q);
  await input.press('Enter');
  await recorded;
}
