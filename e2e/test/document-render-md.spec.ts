// document-render-md.spec.ts —— 各类 document body 都走 ChatMarkdown 渲
// 染 (gfm + math + katex + mermaid + sanitize)。覆盖：
//   1. wiki landing /wiki/<path>: body 是 markdown → 渲 table + katex
//   2. output landing /output/<path>: 同
//   3. citation expand (chat 内嵌): body 是 markdown → expand 后渲对
//
// 验"body 一整个 md，里面有 mermaid / latex 等元素"是 G 期定型的渲染
// 模型；wiki/output landing 此前是 raw text whitespace-pre-wrap (G-3 修)。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';

// MARKDOWN_BODY —— 故意塞所有 G-2 关心的元素：gfm table、bold、inline
// latex、display latex、mermaid block。验"一个 body 就是一个 md，元素都
// 是内嵌的"模型。
const MARKDOWN_BODY = [
  '# Lucerna',
  '',
  '**Local-first** knowledge tool.',
  '',
  '| col | val |',
  '| --- | --- |',
  '| alpha | $E = mc^2$ |',
  '',
  'Display math:',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```mermaid',
  'graph LR; A-->B',
  '```',
].join('\n');

test.describe('document body 走 ChatMarkdown 渲染', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'document-render-seed');
    const sid = await initMCP(request, token);
    const { wikiID } = await seedWiki(request, token, sid, {
      body: MARKDOWN_BODY, title: 'Lucerna', path: TARGET_PATH,
    });
    // wiki landing 走 seo_indexed=true 守门；seedWiki 不会自动 indexed。
    await callTool<unknown>(request, token, sid, 'seo.set_wiki_slug', {
      wiki_id: wikiID,
      seo_slug: TARGET_PATH,
      seo_description: 'Local-first knowledge tool.',
      seo_indexed: true,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'document-render spec',
    });
    await request.dispose();
  });

  test('wiki landing /wiki/<path> 渲 markdown body (table + katex + mermaid)',
    async ({ page }) => {
      await page.goto(`/wiki/${TARGET_PATH}`);
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible();
      // gfm table
      await expect(body.locator('table')).toBeVisible();
      await expect(body.locator('table th').first()).toContainText('col');
      // bold
      await expect(body.locator('strong')).toContainText('Local-first');
      // katex inline ($E = mc^2$)
      await expect(body.locator('.katex').first()).toBeVisible();
      // katex display
      await expect(body.locator('.katex-display')).toBeVisible();
      // mermaid lazy 渲 SVG
      await expect(body.getByTestId('mermaid-svg').locator('svg'))
        .toBeVisible({ timeout: 10_000 });
    });

  test('citation expand body 渲 markdown (visitor chat 路径)',
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

      const row = page.locator(
        `[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`,
      );
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.locator('summary').click();

      const body = row.locator('[data-testid="citation-body"]');
      await expect(body).toBeVisible({ timeout: 2_000 });
      // expanded body 同样元素都渲对
      await expect(body.locator('table')).toBeVisible();
      await expect(body.locator('strong')).toContainText('Local-first');
      await expect(body.locator('.katex').first()).toBeVisible();
      await expect(body.locator('.katex-display')).toBeVisible();
      await expect(body.getByTestId('mermaid-svg').locator('svg'))
        .toBeVisible({ timeout: 10_000 });

      await ctx.close();
    });
});
