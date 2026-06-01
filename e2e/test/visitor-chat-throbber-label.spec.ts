// visitor-chat-throbber-label.spec.ts —— G-8: throbber 文案 ("searching
// corpus" / "reading entry" / ...) 来自 backend ToolSpec.progress_label，
// frontend 走 zustand registry 读，不再硬编码。
//
// 验法：visitor 触发 corpus_search + corpus_read，verify 两个 throbber
// `<li>` 的文字内容跟 backend 注册的 label 一致。

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

test.describe('throbber label 走 backend ToolSpec.progress_label registry', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-label-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-label spec',
    });
    await request.dispose();
  });

  test('throbber 文案 = backend 注册的 progress_label ("searching corpus" / "reading entry")',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await page.goto(`/?code=${CODE}`);
      await page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/sessions') && r.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('tell me about lucerna');
      await input.press('Enter');

      // 两个 throbber 出现 + 文字 = backend progress_label
      const search = page.getByTestId('tool-throbber-corpus_search');
      await expect(search).toBeVisible({ timeout: 20_000 });
      await expect(search).toContainText('searching corpus');

      const read = page.getByTestId('tool-throbber-corpus_read');
      await expect(read).toBeVisible({ timeout: 20_000 });
      await expect(read).toContainText('reading entry');

      await ctx.close();
    });
});
