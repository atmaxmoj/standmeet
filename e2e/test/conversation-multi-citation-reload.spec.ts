// conversation-multi-citation-reload.spec.ts —— 多轮各自的引用,刷新后不串台。
//
// 后端聚合是按 assistant 消息逐条解析 cited_*,所以"每条 dialog 只带自己那条
// 引用"是个容易写错的点(一不小心把全会话的引用都挂到每条上)。这条守:两轮各
// 引一篇不同的 doc → 刷新 → 每个 path 的 citation-row 各恰好 1 条、各指各的。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'MULTICITE-RELOAD-001';
const NAME = 'Mona';
const LUCERNA = 'projects/lucerna';
const FAMILY = 'personal/family';

test.describe('多轮各自引用,刷新后不串台', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'multicite-reload-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is my local-first knowledge tool.', title: 'Lucerna', path: LUCERNA,
    });
    await seedWiki(request, token, sid, {
      body: 'my mother is from singapore, my dad from BC.', title: 'Family', path: FAMILY,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('两轮各引一篇 → 刷新 → 每个 path 恰好 1 条 citation-row,各指各的', async ({ page }) => {
    await enterCodeSession(page, CODE, NAME);
    const input = page.getByTestId('chat-input-field');

    // Mock is pure registration: each turn's corpus_read is what cites its doc.
    const lucernaTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: LUCERNA },
    });
    await askAndRecord(page, input, `tell me about lucerna${lucernaTag}`);
    await expandRefsContaining(page, LUCERNA);
    await expect(rowFor(page, LUCERNA)).toBeVisible({ timeout: 20_000 });

    await expect(input).toBeEnabled({ timeout: 20_000 });
    const familyTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: FAMILY },
    });
    await askAndRecord(page, input, `tell me about your family${familyTag}`);
    await expandRefsContaining(page, FAMILY);
    await expect(rowFor(page, FAMILY)).toBeVisible({ timeout: 20_000 });

    // 刷新 → 聚合重建 transcript。references 又折叠了,逐个展开后断言:
    // 每个 path 恰好 1 条(没串台)、各指各的公开页。
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expandRefsContaining(page, LUCERNA);
    await expandRefsContaining(page, FAMILY);

    await expect(rowFor(page, LUCERNA)).toHaveCount(1);
    await expect(rowFor(page, FAMILY)).toHaveCount(1);
    await expect(rowFor(page, LUCERNA)).toHaveAttribute('href', `/wiki/${LUCERNA}`);
    await expect(rowFor(page, FAMILY)).toHaveAttribute('href', `/wiki/${FAMILY}`);
  });
});

function rowFor(page: Page, path: string) {
  return page.locator(`[data-testid="citation-row"][data-citation-path="${path}"]`);
}

async function askAndRecord(
  page: Page, input: ReturnType<Page['getByTestId']>, q: string,
): Promise<void> {
  // #28: backend 落库在 /agent/turn 流末端(`done` 之前);res.finished() = 流
  // 读完 = 已落库。这条 SSE 屏障替代旧的 /dialogs 落库等待。
  const turnDone = page.waitForResponse((r) =>
    r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
  await input.fill(q);
  await input.press('Enter');
  await (await turnDone).finished();
}

// expandRefsContaining —— references 默认折叠;展开含 path 那条的 details。
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs.first()).toBeVisible({ timeout: 20_000 });
  await refs.first().locator('summary').first().click();
}
