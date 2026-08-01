// document-render.spec.ts —— wiki landing 走 ChatMarkdown 渲染全部
// markdown 特性 (gfm / katex / mermaid / xss sanitize / 基础 markdown)。
//
// 之前走 /dev/chat-render?fixture=... fixture page 验；G-6 拆掉 dev route
// 后改成走真 prod 路径：seed wiki 的 body = 各 fixture，visit /wiki/<path>。
// 同一个 ChatMarkdown 组件、同一套 plugins、同一个 .chat-md scope；测
// 等于测 prod。

import { test, expect, type APIRequestContext } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

// FIXTURE_BODIES —— 各 markdown feature 一段 body。等 seed 完成后用对应
// path 落地，spec 直接 visit /wiki/<path>。
const FIXTURE_BODIES = {
  markdown: [
    '# Heading',
    '',
    'A paragraph with **bold**, *italic*, and `inline code`.',
    '',
    '- item one',
    '- item two',
    '',
    '[link](https://example.com)',
  ].join('\n'),

  gfm: [
    '| col1 | col2 |',
    '| ---- | ---- |',
    '| a    | b    |',
    '',
    '~~strike~~',
    '',
    'https://example.com',
  ].join('\n'),

  katex: [
    'Inline: $E = mc^2$',
    '',
    'Display:',
    '',
    '$$',
    '\\int_0^1 x^2 dx',
    '$$',
  ].join('\n'),

  mermaid: [
    '```mermaid',
    'graph LR; A-->B',
    '```',
  ].join('\n'),

  xss: [
    'Before',
    '',
    '<script>window.__pwned = true</script>',
    '',
    '<img src="x" onerror="window.__pwned_img = true" />',
    '',
    'After',
  ].join('\n'),
} as const;

type FixtureKey = keyof typeof FIXTURE_BODIES;

test.describe('document body (wiki landing) ChatMarkdown 渲染', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedAllFixtures(request);
    await request.dispose();
  });

  test('基础 markdown · heading / bold / italic / inline code / list / link',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('markdown')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible();
      await expect(body.locator('h1')).toHaveText('Heading');
      await expect(body.locator('strong').first()).toHaveText('bold');
      await expect(body.locator('em').first()).toHaveText('italic');
      await expect(body.locator('code').first()).toHaveText('inline code');
      await expect(body.locator('ul li').first()).toContainText('item one');
      await expect(body.locator('a').first()).toHaveAttribute('href', 'https://example.com');
    });

  test('gfm · table / strikethrough / autolink',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('gfm')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.locator('table')).toBeVisible();
      await expect(body.locator('table th').first()).toContainText('col1');
      await expect(body.locator('table td').first()).toContainText('a');
      await expect(body.locator('del')).toHaveText('strike');
      await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com');
    });

  test('katex · inline + display 都有 .katex / .katex-display 元素',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('katex')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.locator('.katex').first()).toBeVisible();
      await expect(body.locator('.katex-display')).toBeVisible();
    });

  test('mermaid · ```mermaid block 异步渲染 <svg>',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('mermaid')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.getByTestId('mermaid-svg').locator('svg'))
        .toBeVisible({ timeout: 10_000 });
    });

  test('xss sanitize · <script> 被剔除 + onerror 不触发',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('xss')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body).toContainText('Before');
      await expect(body).toContainText('After');
      await expect(body.locator('script')).toHaveCount(0);
      // 恶意 <img onerror> 应被 sanitize 整个剔除 —— 断言它不存在（web-first
      // 断言自动重试等 DOM settle），img 没了 onerror 就永无机会 fire。
      await expect(body.locator('img')).toHaveCount(0);
      const pwned = await page.evaluate(
        () => Boolean((window as unknown as { __pwned?: boolean }).__pwned)
          || Boolean((window as unknown as { __pwned_img?: boolean }).__pwned_img),
      );
      expect(pwned).toBe(false);
    });
});

// 地址树派生:URL = 标题 slug。title `Render fixture · ${key}` → render-fixture-${key}。
function pathFor(key: FixtureKey): string {
  return `render-fixture-${key}`;
}

async function seedAllFixtures(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'document-render-seed');
  const sid = await initMCP(request, token);
  for (const key of Object.keys(FIXTURE_BODIES) as FixtureKey[]) {
    const path = pathFor(key);
    const { wikiID } = await seedWiki(request, token, sid, {
      body: FIXTURE_BODIES[key],
      title: `Render fixture · ${key}`, path,
    });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: wikiID, excerpt: `${key} render fixture.`,
    });
  }
}
