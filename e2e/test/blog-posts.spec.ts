// blog-posts.spec.ts —— blog 全链 e2e。
//
// 业务故事：
//   1. owner 在 /admin/posts 手写一个 markdown post → publish → 访客
//      打开 /blog 看到它 → 点进文章页 → 渲染 body blocks (## → h2,
//      > → pull-quote, 段落 → p)。
//   2. owner 在 Claude Desktop 让 AI 调 post_create (publish=true) →
//      访客 /blog 列表也能看到这条。
//   3. infinite scroll：post_create 灌 15 篇 (default limit 12) →
//      visitor 滚到底 → 第 13~15 条自动 append。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('blog: hand-write + MCP handoff + infinite scroll', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('owner hand-writes a post in admin → visitor sees it on /blog',
    async ({ adminPage, page }) => {
      await openAdminPosts(adminPage);
      await fillNewPost(adminPage, {
        slug: 'eval-is-the-product',
        title: 'Evaluation is the product',
        excerpt: 'The eval is the product. The model is the tax.',
        body: 'First paragraph here.\n\n## A heading\n\nSecond paragraph.\n\n> A pull-quote line.',
        cover: { headline: 'eval is the product.', sub: 'the model is the tax.', hue: 'amber' },
        tags: 'eval, thinking',
      });
      await expect(adminPage.getByTestId('post-row-eval-is-the-product')).toBeVisible({ timeout: 5_000 });

      // visitor side
      await goto(page, '/blog');
      await expect(page.locator('[data-blog-card="eval-is-the-product"]').first()).toBeVisible();
      await page.locator('a[href="/blog/eval-is-the-product"]').first().click();
      await expect(page.getByTestId('blog-article-title')).toHaveText('Evaluation is the product');
      const body = page.getByTestId('blog-article-body');
      await expect(body.locator('h2')).toHaveText('A heading');
      await expect(body.locator('blockquote')).toContainText('pull-quote');
    });

  test('owner hands off to AI via MCP post_create → visible on /blog',
    async ({ request, page }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'blog-mcp-token');
      const sid = await initMCP(request, apiToken);
      await callTool<{ post_id: string }>(request, apiToken, sid, 'post_create', {
        slug: 'mcp-authored-post',
        title: 'MCP wrote this',
        excerpt: 'A post the AI authored via the MCP handoff path.',
        body_md: 'AI-written paragraph.\n\n## Section\n\nMore content.',
        cover_headline: 'mcp wrote this.',
        cover_sub: 'no human typing.',
        cover_hue: 'violet',
        tags: ['mcp', 'meta'],
        publish: true,
      });
      await goto(page, '/blog');
      await expect(page.locator('[data-blog-card="mcp-authored-post"]').first()).toBeVisible({ timeout: 5_000 });
    });

  test('infinite scroll: 13+ posts → scroll loads page 2',
    async ({ request, page }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'blog-scroll-token');
      const sid = await initMCP(request, apiToken);
      // seed 13 extra posts so page 1 (12 default) doesn't cover all.
      await seedExtraPosts(request, apiToken, sid, 13);

      await goto(page, '/blog');
      // order is published_at desc, so newest 13 visible first, oldest
      // (scroll-01) lands on page 2. scroll sentinel into view → wait
      // for the page-2 fetch to land (matched by URL), then assert.
      const pageTwo = page.waitForResponse((res) =>
        res.url().includes('/api/v1/posts') && res.url().includes('cursor=')
        && res.status() === 200);
      await page.getByTestId('blog-scroll-sentinel').scrollIntoViewIfNeeded();
      await pageTwo;
      await expect(page.locator('[data-blog-card="scroll-01"]').first())
        .toBeVisible({ timeout: 5_000 });
    });
});

async function openAdminPosts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'posts');
  await page.waitForURL('**/admin/posts');
}

interface HandwriteInput {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  cover: { headline: string; sub: string; hue: 'amber' | 'violet' | 'acid' };
  tags: string;
}

async function fillNewPost(page: Page, input: HandwriteInput): Promise<void> {
  await page.getByRole('button', { name: /new post/i }).click();
  await page.getByTestId('post-field-slug').fill(input.slug);
  await page.getByTestId('post-field-title').fill(input.title);
  await page.getByTestId('post-field-excerpt').fill(input.excerpt);
  await page.getByTestId('post-field-cover-headline').fill(input.cover.headline);
  await page.getByTestId('post-field-cover-sub').fill(input.cover.sub);
  await page.getByTestId('post-field-cover-hue').selectOption(input.cover.hue);
  await page.getByTestId('post-field-tags').fill(input.tags);
  await page.getByTestId('post-field-body').fill(input.body);
  await page.getByTestId('post-create-submit').click();
}

async function seedExtraPosts(
  request: APIRequestContext, token: string, sid: string, count: number,
): Promise<void> {
  // sequential HTTP round-trips give natural μs-level stagger on
  // postgres now(); enough to avoid timestamp ties (would break cursor
  // pagination which uses strict `<` on published_at).
  for (let i = 0; i < count; i++) {
    const idx = String(i + 1).padStart(2, '0');
    await callTool(request, token, sid, 'post_create', {
      slug: `scroll-${idx}`,
      title: `Scroll Post ${idx}`,
      excerpt: `Test post ${idx}.`,
      body_md: `Body paragraph ${idx}.`,
      cover_headline: `post ${idx}.`,
      cover_sub: 'seeded.',
      cover_hue: 'acid',
      tags: ['scroll-test'],
      publish: true,
    });
  }
}
