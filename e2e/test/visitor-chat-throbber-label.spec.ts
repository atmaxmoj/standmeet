// visitor-chat-throbber-label.spec.ts —— G-8: throbber 文案 ("searching
// corpus" / "reading entry" / ...) 来自 backend BindingTool.ProgressLabel
// (H.8 之前是 ToolSpec.progress_label，wire 形态不变)，frontend 走
// zustand registry 读，不再硬编码。
//
// 验法：visitor 触发 corpus_search + corpus_read，verify 两个 throbber
// `<li>` 的文字内容跟 backend 注册的 label 一致。

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

test.describe('throbber label 走 backend BindingTool.ProgressLabel registry', () => {
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

  test('corpus throbber 带 document(search 显 verb / read 显在读的 path)',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about lucerna');
      await input.press('Enter');

      // corpus throbber 现在带 document(owner: "他到底在读什么"):
      // corpus_search 显 verb,corpus_read 显在读哪个 path(projects/lucerna)。
      const search = page.getByTestId('tool-throbber-corpus_search');
      await expect(search).toBeVisible({ timeout: 20_000 });
      await expect(search).toContainText('searching');

      const read = page.getByTestId('tool-throbber-corpus_read');
      await expect(read).toBeVisible({ timeout: 20_000 });
      await expect(read).toContainText('projects/lucerna');

      await ctx.close();
    });
});
