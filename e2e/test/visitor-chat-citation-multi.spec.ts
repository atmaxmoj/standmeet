// visitor-chat-citation-multi.spec.ts —— G-3 follow-up：多 dialog 各自带
// 1 个 citation 行，各自 link 到 document 公开页 / collapse。`<details>` 本身是原生
// 元素，但验"两个 dialog 卡片的 citation row 不会串状态"是有意义的：
// 一个的 toggle 不影响另一个；下一个 dialog 出现时上一个的展开状态保留。

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

const CODE = 'INTRO-001';
const LUCERNA = 'projects/lucerna';
const FAMILY = 'personal/family';

test.describe('多 dialog citation 各自 link 到 document 公开页', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'citation-multi-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is my local-first knowledge tool.',
      title: 'Lucerna', path: LUCERNA,
    });
    await seedWiki(request, token, sid, {
      body: 'my mother is from singapore, my dad from BC.',
      title: 'Family', path: FAMILY,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'citation-multi spec',
    });
    await request.dispose();
  });

  test('两个 dialog 各 1 cited row → 各是 link,各自跳那篇 document',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      const input = page.locator('[data-testid="chat-input-field"]');
      // 第一轮：lucerna —— references 默认折叠,先展开含 lucerna 那条的列表。
      // Mock is pure registration: the corpus_read of lucerna is what cites it.
      const lucernaTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: LUCERNA },
      });
      await input.fill(`tell me about lucerna${lucernaTag}`);
      await input.press('Enter');
      const lucernaRow = page.locator(
        `[data-testid="citation-row"][data-citation-path="${LUCERNA}"]`,
      );
      await expandRefsContaining(page, LUCERNA);
      await expect(lucernaRow).toBeVisible({ timeout: 20_000 });

      // 第二轮：family — 等 input 重新 enable
      await expect(input).toBeEnabled({ timeout: 20_000 });
      const familyTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: FAMILY },
      });
      await input.fill(`tell me about your family${familyTag}`);
      await input.press('Enter');
      const familyRow = page.locator(
        `[data-testid="citation-row"][data-citation-path="${FAMILY}"]`,
      );
      await expandRefsContaining(page, FAMILY);
      await expect(familyRow).toBeVisible({ timeout: 20_000 });

      // 每条引用都是 link → 各自跳那篇 document 的公开页(/<genre>/<树派生 path>),
      // 互不相干、都不再 inline 展开 body。
      await expect(lucernaRow).toHaveAttribute('href', `/wiki/${LUCERNA}`);
      await expect(familyRow).toHaveAttribute('href', `/wiki/${FAMILY}`);
      await expect(lucernaRow.locator('[data-testid="citation-body"]')).toHaveCount(0);
      await expect(familyRow.locator('[data-testid="citation-body"]')).toHaveCount(0);

      await ctx.close();
    });
});

// expandRefsContaining —— references 默认折叠;找到含 path 那条 row 的
// references details,点它的 summary 展开,让该 row 可见。
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs).toBeVisible({ timeout: 20_000 });
  await refs.locator('summary').first().click();
}
