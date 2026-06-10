// visitor-chat-citations-survive-reload.spec.ts —— 引用属于 conversation 聚合,
// 刷新后必须还在。
//
// 后端 messages.cited_wiki_ids/cited_output_ids 早就持久化了(RecordDialog 落表),
// 但 GET /sessions/<conv> 快照之前只回 {question,answer},把引用丢了 —— 刷新后
// transcript 重建成 citations:[],references 消失。这条守:答完带引用 → 刷新 →
// 引用仍在(citation-row 链接还指向那篇 doc)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'CITE-RELOAD-001';
const TARGET_PATH = 'projects/lucerna';

test.describe('引用属于会话聚合,刷新后仍在', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedCorpus(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('答复带引用 → reload → citation-row 仍在且指向该 doc', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, 'Cora');

    const dialogRecorded = page.waitForResponse((r) =>
      r.url().includes('/dialogs') && r.status() === 204, { timeout: 20_000 });
    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill('tell me about lucerna');
    await input.press('Enter');
    await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });

    // live:references 默认折叠,展开后引用指向 /wiki/projects/lucerna。
    await expandRefsContaining(page, TARGET_PATH);
    const cite = page.locator(`[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`);
    await expect(cite).toBeVisible({ timeout: 20_000 });
    await expect(cite).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);
    await dialogRecorded;

    // reload → 聚合重建 transcript,引用必须从后端 cited_* 解析回来,不能丢。
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expandRefsContaining(page, TARGET_PATH);
    await expect(cite).toBeVisible({ timeout: 15_000 });
    await expect(cite).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);

    await ctx.close();
  });
});

// expandRefsContaining —— references 默认折叠;展开含 path 那条的 details。
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs.first()).toBeVisible({ timeout: 20_000 });
  await refs.first().locator('summary').first().click();
}

async function seedCorpus(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cite-reload-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: TARGET_PATH,
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
}
