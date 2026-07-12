// visitor-chat-citation-expand.spec.ts —— G-3: cited 行 clickable，点开 inline
// 展开原文 body。corpus_read 时 backend 已经把 body 流回 (marshalKindBodyPath
// 含 body)；frontend 存进 Citation.body，<details>/<summary> 点开就渲。
//
// 用户故事：visitor 问"tell me about lucerna" → mock 经 corpus_search +
// corpus_read 走完 → "drawn from" 出现 cited 行 → 点 lucerna 行 → inline
// 展开 wiki body 文字 ("lucerna is a local-first knowledge tool I built.")。

import { test, expect } from '@/fixtures/test';

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

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';
const TARGET_BODY = 'lucerna is a local-first knowledge tool I built.';

test.describe('citation row 可点 + inline 展开原文', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'citation-expand-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: TARGET_BODY, title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'citation expand spec',
    });
    await request.dispose();
  });

  test('visitor 问 → cited 行出现 → 是 link → 跳那篇 document 的公开页',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      // Mock is pure registration: the corpus_read of lucerna is what cites it.
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${readTag}`);
      await input.press('Enter');

      // 等 cited "references · N" 出现 (cited 来自 tool_completed 事件)。
      // 现在默认折叠(像普通 AI chat),先点 references summary 展开列表。
      const citations = page.getByTestId('citations');
      await expect(citations).toBeVisible({ timeout: 20_000 });
      await citations.locator('summary').first().click();

      // 锁定 lucerna 那行 citation。
      const row = page.locator(
        `[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`,
      );
      await expect(row).toBeVisible({ timeout: 5_000 });

      // 点引用 = 跳那篇 document 在 owner 站上的公开页:link href =
      // /<genre>/<树派生 path>,新标签打开。不再 inline 展开 body。
      await expect(row).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);
      await expect(row).toHaveAttribute('target', '_blank');
      await expect(row.locator('[data-testid="citation-body"]')).toHaveCount(0);

      await ctx.close();
    });
});
