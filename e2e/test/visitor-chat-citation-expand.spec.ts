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
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

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

  test('visitor 问 → cited 行出现 → click → inline body 展开渲染原文',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await page.goto(`/?code=${CODE}`);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('tell me about lucerna');
      await input.press('Enter');

      // 等 cited "drawn from" 出现 (cited 来自 tool_completed 事件)。
      const citations = page.getByTestId('citations');
      await expect(citations).toBeVisible({ timeout: 20_000 });

      // 锁定 lucerna 那行 citation。
      const row = page.locator(
        `[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`,
      );
      await expect(row).toBeVisible({ timeout: 5_000 });

      // 默认 collapsed：body 在 DOM 但 details 没开。
      const summary = row.locator('summary');
      await summary.click();

      // 点开后：body container 出现 + 含 wiki body 文字。
      const body = row.locator('[data-testid="citation-body"]');
      await expect(body).toBeVisible({ timeout: 2_000 });
      await expect(body).toContainText(TARGET_BODY);

      // 再点一下折叠 (details 默认 toggle 行为)。
      await summary.click();
      await expect(body).not.toBeVisible({ timeout: 2_000 });

      await ctx.close();
    });
});
