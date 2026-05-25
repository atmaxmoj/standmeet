// blog-posts.spec.ts —— blog 全链 e2e。
//
// 业务故事：
//   1. owner 在 /admin/posts 手写一个 markdown post → publish → 访客
//      打开 /blog 看到它 → 点进文章页 → react-markdown + remark-gfm
//      把 GFM 全套特性渲染到 DOM (h1/h2/h3 / 段落 / bold / italic / strike /
//      link / code / fence / 列表 / 任务列表 / blockquote / table / hr / image)。
//   2. owner 在 Claude Desktop 让 AI 调 post_create (publish=true) →
//      访客 /blog 列表也能看到这条；MCP 路径同样渲染丰富 markdown。
//   3. infinite scroll：post_create 灌 15 篇 (default limit 12) →
//      visitor 滚到底 → 第 13~15 条自动 append。
//   4. XSS：markdown 里塞 `<script>` 必须被 escape，不能跑到 DOM 里。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

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

// RICH_MD —— 一段塞满 GFM 特性的 markdown。每个 feature 都会被独立断言。
const RICH_MD = [
  'Opening paragraph with **bold** and _italic_ and ~~strike~~ and `inline code` and a [link](https://example.com/x) inline.',
  '',
  '## A heading',
  '',
  'Second paragraph after the heading.',
  '',
  '### Sub heading',
  '',
  '- bullet one with **emphasis**',
  '- bullet two',
  '- [ ] task open',
  '- [x] task done',
  '',
  '1. ordered first',
  '2. ordered second',
  '',
  '> A pull-quote line of insight.',
  '',
  '```ts',
  'const ok: number = 42;',
  '```',
  '',
  '| col a | col b |',
  '| --- | --- |',
  '| cell a1 | cell b1 |',
  '| cell a2 | cell b2 |',
  '',
  '---',
  '',
  '![alt text here](https://example.com/img.png)',
].join('\n');

test.describe.serial('blog: rich markdown render (hand-write + MCP + XSS)', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner hand-writes a rich markdown post → /blog renders every GFM element',
    async ({ adminPage, page }) => {
      await openAdminPosts(adminPage);
      await fillNewPost(adminPage, {
        slug: 'rich-markdown-essay',
        title: 'Rich markdown essay',
        excerpt: 'Every GFM feature must round-trip cleanly.',
        body: RICH_MD,
        cover: { headline: 'rich markdown.', sub: 'the whole spec.', hue: 'amber' },
        tags: 'markdown, gfm',
      });
      await expect(adminPage.getByTestId('post-row-rich-markdown-essay'))
        .toBeVisible({ timeout: 5_000 });
      await goto(page, '/blog');
      await expect(page.locator('[data-blog-card="rich-markdown-essay"]').first()).toBeVisible();
      await page.locator('a[href="/blog/rich-markdown-essay"]').first().click();
      await expect(page.getByTestId('blog-article-title')).toHaveText('Rich markdown essay');
      await assertGFMRendering(page);
    });

  test('owner hands off to AI via MCP post_create → renders markdown features',
    async ({ request, page }) => {
      await mcpCreatePost(request, 'blog-mcp-token', {
        slug: 'mcp-authored-post',
        title: 'MCP wrote this',
        excerpt: 'A post the AI authored via the MCP handoff path.',
        body_md: 'AI-written paragraph with **bold**.\n\n## Section\n\n- list item one\n- list item two',
        cover_headline: 'mcp wrote this.', cover_sub: 'no human typing.',
        cover_hue: 'violet', tags: ['mcp', 'meta'],
      });
      await goto(page, '/blog');
      await page.locator('a[href="/blog/mcp-authored-post"]').first().click();
      const body = page.getByTestId('blog-article-body');
      await expect(body.locator('h2')).toHaveText('Section');
      await expect(body.locator('strong')).toHaveText('bold');
      await expect(body.locator('ul li')).toHaveCount(2);
    });

  test('XSS: <script> in markdown body is escaped, not executed',
    async ({ request, page }) => {
      await mcpCreatePost(request, 'blog-xss-token', {
        slug: 'xss-attempt',
        title: 'XSS attempt',
        excerpt: 'Owner-untrusted markdown must not execute.',
        body_md: 'Before.\n\n<script>window.__xssRan = true;</script>\n\nAfter.',
        cover_headline: 'xss.', cover_sub: 'must escape.', cover_hue: 'acid',
        tags: ['security'],
      });
      await goto(page, '/blog/xss-attempt');
      await expect(page.getByTestId('blog-article-body').locator('script')).toHaveCount(0);
      const flag = await page.evaluate(() =>
        (window as Window & { __xssRan?: boolean }).__xssRan);
      expect(flag).toBeFalsy();
    });
});

test.describe.serial('blog: infinite scroll', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('13+ posts → scroll loads page 2',
    async ({ request, page }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'blog-scroll-token');
      const sid = await initMCP(request, apiToken);
      await seedExtraPosts(request, apiToken, sid, 13);
      await goto(page, '/blog');
      // order is published_at desc, so newest 13 visible first, oldest
      // (scroll-01) lands on page 2.
      const pageTwo = page.waitForResponse((res) =>
        res.url().includes('/api/v1/posts') && res.url().includes('cursor=')
        && res.status() === 200);
      await page.getByTestId('blog-scroll-sentinel').scrollIntoViewIfNeeded();
      await pageTwo;
      await expect(page.locator('[data-blog-card="scroll-01"]').first())
        .toBeVisible({ timeout: 5_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

interface MCPCreateInput {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_headline: string;
  cover_sub: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  tags: string[];
}

async function mcpCreatePost(
  request: APIRequestContext, tokenName: string, in_: MCPCreateInput,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  await callTool<{ post_id: string }>(request, apiToken, sid, 'post_create', {
    ...in_, publish: true,
  });
}

async function assertGFMRendering(page: Page): Promise<void> {
  const body = page.getByTestId('blog-article-body');
  // headings
  await expect(body.locator('h2')).toHaveText('A heading');
  await expect(body.locator('h3')).toHaveText('Sub heading');
  // inline marks
  await expect(body.locator('strong').first()).toHaveText('bold');
  await expect(body.locator('em').first()).toHaveText('italic');
  await expect(body.locator('del').first()).toHaveText('strike');
  await expect(body.locator('code').first()).toContainText('inline code');
  // link with rel=noopener
  const link = body.locator('a[href="https://example.com/x"]');
  await expect(link).toHaveText('link');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // lists (bullet + ordered + task)
  await expect(body.locator('ul').first().locator('> li')).toHaveCount(4); // 2 bullets + 2 task
  await expect(body.locator('ol').first().locator('> li')).toHaveCount(2);
  await expect(body.locator('input[type="checkbox"]')).toHaveCount(2);
  // blockquote
  await expect(body.locator('blockquote')).toContainText('pull-quote');
  // code block with language
  await expect(body.locator('pre code.language-ts')).toContainText('const ok');
  // table (GFM)
  await expect(body.locator('table thead th')).toHaveCount(2);
  await expect(body.locator('table tbody tr')).toHaveCount(2);
  await expect(body.locator('table tbody tr').first().locator('td').first()).toHaveText('cell a1');
  // hr
  await expect(body.locator('hr')).toHaveCount(1);
  // image
  await expect(body.locator('img[src="https://example.com/img.png"]')).toHaveAttribute('alt', 'alt text here');
}

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
