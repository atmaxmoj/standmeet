// visitor-chat-tool-cards.spec.ts —— G-4: AI 调 tool 后，tool result 渲
// 成卡片（不只是 throbber）。覆盖：
//   1. corpus_search → SearchHitsCard 列出匹配的 path/title/genre/summary
//   2. corpus_read 的 tool_completed 走 Citation 不重复（卡片不含 corpus_read）
//   3. calendar_book 跳过 (G-7 接管)
//
// skill_* / ext_* generic dump 留 G-5+ 时有 fixture 再加 spec；现在 mock
// 路径主要触发 corpus_search 跟 corpus_read。

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

test.describe('tool call 渲染成卡片', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'tool-cards-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'tool-cards spec',
    });
    await request.dispose();
  });

  test('visitor 问 → corpus_search 卡显示 hits → corpus_read 走 citation 不重复',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about lucerna');
      await input.press('Enter');

      // corpus_search 卡出现(默认折叠),点 summary 展开看 hits。
      const searchCard = page.getByTestId('tool-card-corpus_search');
      await expect(searchCard).toBeVisible({ timeout: 20_000 });
      await searchCard.locator('summary').first().click();
      const hit = searchCard.locator('[data-testid="tool-card-hit"][data-path="projects/lucerna"]');
      await expect(hit).toBeVisible();
      await expect(hit).toContainText('Lucerna');
      await expect(hit).toContainText('wiki');

      // corpus_read 不渲卡 (Citation 接管)：tool-card-corpus_read 不存在
      await expect(page.getByTestId('tool-card-corpus_read'))
        .toHaveCount(0);

      // Citation 仍正常显示
      await expect(page.getByTestId('citations')).toBeVisible();

      await ctx.close();
    });
});
