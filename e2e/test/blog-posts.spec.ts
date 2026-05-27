// blog-posts.spec.ts —— blog 全链 e2e。
//
// 业务故事：
//   1. owner 在 /admin/posts 用 Tiptap 编辑器写：打字、`/` 唤出 slash menu
//      插入 heading → publish → 访客 /blog 看到 → 文章页渲染出对应结构。
//   2. owner 在 Claude Desktop 让 AI 调 post_create (publish=true) → 访客
//      /blog 列表也能看到 → 文章页渲染丰富 GFM 特性 (h2 / bold / 列表)。
//      （rich GFM full coverage 落在这里——MCP 路径喂 markdown 是 AI 主要
//      入口，且不依赖编辑器交互能力。）
//   3. infinite scroll：post_create 灌 13 篇 (default limit 12) → visitor
//      滚到底 → 第 13 条自动 append。
//   4. XSS：markdown 里塞 `<script>` 必须被 escape，不能跑到 DOM 里。
//   5. image upload：owner paste 图片到编辑器 → 上传到 MinIO → markdown
//      存 `standmeet-asset:<id>` URI → /blog 渲染时 backend resolve 成 presigned
//      URL；orphan 扫此时 = 0（asset 有 post 引用）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import {
  uploadCoverImage, pasteImage, assertAdminBodyHasURI,
} from '@/fixtures/blog-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// RICH_MD —— 一段塞满 GFM 特性的 markdown，喂进 MCP 路径，验 react-markdown
// + remark-gfm 全 GFM 渲染。
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

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('blog: editor flow + rich render + XSS', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner types in Tiptap editor + slash menu → /blog renders the structure',
    async ({ adminPage, page }) => {
      await openAdminPosts(adminPage);
      await fillPostMeta(adminPage, {
        slug: 'editor-flow', title: 'Editor flow',
        excerpt: 'Type prose, slash a heading.',
        cover: { headline: 'editor.', sub: 'slash menu.', hue: 'amber' },
        tags: 'editor, slash',
      });
      await focusEditor(adminPage);
      await typeText(adminPage, 'First paragraph.');
      await newLine(adminPage);
      await pickSlashItem(adminPage, 'h2');
      await typeText(adminPage, 'A heading');
      await adminPage.getByTestId('post-create-submit').click();
      await expect(adminPage.getByTestId('post-row-editor-flow'))
        .toBeVisible({ timeout: 5_000 });

      await goto(page, '/blog');
      await page.locator('a[href="/blog/editor-flow"]').first().click();
      const body = page.getByTestId('blog-article-body');
      await expect(body.locator('h2')).toHaveText('A heading');
      await expect(body.locator('p').first()).toContainText('First paragraph.');
    });

  test('MCP post_create with full GFM markdown → every feature renders',
    async ({ request, page }) => {
      await mcpCreatePost(request, 'blog-mcp-token', {
        slug: 'rich-markdown-essay', title: 'Rich markdown essay',
        excerpt: 'Every GFM feature must round-trip cleanly.',
        body_md: RICH_MD,
        cover_headline: 'rich markdown.', cover_sub: 'the whole spec.',
        cover_hue: 'amber', tags: ['markdown', 'gfm'],
      });
      await goto(page, '/blog');
      await page.locator('a[href="/blog/rich-markdown-essay"]').first().click();
      await expect(page.getByTestId('blog-article-title')).toHaveText('Rich markdown essay');
      await assertGFMRendering(page);
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

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('blog: atomic image upload via multipart save', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner uploads cover image → /blog cover renders with image background',
    async ({ adminPage, page, request }) => {
      await openAdminPosts(adminPage);
      await fillPostMeta(adminPage, {
        slug: 'with-cover', title: 'Post with cover',
        excerpt: 'Cover image attached.',
        cover: { headline: 'cover.', sub: 'image.', hue: 'amber' },
        tags: 'cover',
      });
      await uploadCoverImage(adminPage);
      // wait for preview img to appear → upload completed
      await expect(adminPage.getByAltText('cover preview')).toBeVisible({ timeout: 10_000 });
      await adminPage.getByTestId('post-create-submit').click();
      await expect(adminPage.getByTestId('post-row-with-cover'))
        .toBeVisible({ timeout: 5_000 });

      // 诊断：confirm post stored cover_image_asset_id + asset_urls resolved
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const adminRes = await request.get('/api/admin/posts/', { headers: { 'X-Csrftoken': csrf } });
      const adminPosts = await adminRes.json() as Array<{ slug: string; cover_image_asset_id: string; asset_urls: Record<string, string> }>;
      const stored = adminPosts.find((p) => p.slug === 'with-cover');
      expect(stored).toBeTruthy();
      expect(stored?.cover_image_asset_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(stored?.asset_urls ?? {})).toContain(stored?.cover_image_asset_id);

      // confirm public endpoint also resolves asset_urls
      const publicRes = await request.get('/api/v1/posts/with-cover');
      const publicPost = await publicRes.json() as { cover_image_asset_id: string; asset_urls: Record<string, string> };
      expect(publicPost.cover_image_asset_id).toBe(stored?.cover_image_asset_id);
      expect(Object.keys(publicPost.asset_urls ?? {})).toContain(publicPost.cover_image_asset_id);

      await goto(page, '/blog/with-cover');
      const cover = page.locator('[data-blog-cover]').first();
      const img = cover.locator('img').first();
      const src = await img.getAttribute('src');
      expect(src).toMatch(/localhost(%3A|:)9200/);
    });

  test('paste image in editor → save → /blog renders presigned URL; body_md stores URI',
    async ({ adminPage, page, request }) => {
      await openAdminPosts(adminPage);
      await fillPostMeta(adminPage, {
        slug: 'image-post', title: 'Post with image',
        excerpt: 'Owner pastes an image.',
        cover: { headline: 'image.', sub: 'pasted in.', hue: 'acid' },
        tags: 'image',
      });
      await focusEditor(adminPage);
      await typeText(adminPage, 'See image below.');
      await newLine(adminPage);
      await pasteImage(adminPage, 'pixel.png');
      // wait for img node to appear in editor (paste inserts immediately
      // with blob: URL, server upload happens at submit-time).
      await expect(adminPage.locator('.blog-editor-surface img')).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('post-create-submit').click();
      await expect(adminPage.getByTestId('post-row-image-post'))
        .toBeVisible({ timeout: 10_000 });

      // visitor side: img element with presigned URL
      await goto(page, '/blog/image-post');
      const img = page.getByTestId('blog-article-body').locator('img').first();
      await expect(img).toBeVisible();
      const src = await img.getAttribute('src');
      expect(src).toMatch(/localhost(%3A|:)9200/); // presigned URL host (minio public)

      // admin GET: body_md contains real asset UUID (not pending-) URI
      await assertAdminBodyHasURI(request, OWNER, 'image-post');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('blog: edit existing post', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner clicks edit → changes title → /blog reflects new title',
    async ({ request, adminPage, page }) => {
      await mcpCreatePost(request, 'blog-edit-token', {
        slug: 'editable-post', title: 'Original title',
        excerpt: 'Will be edited.', body_md: 'Original body.',
        cover_headline: 'first.', cover_sub: 'pass.', cover_hue: 'amber',
        tags: ['edit'],
      });
      await openAdminPosts(adminPage);
      await adminPage.getByTestId('post-edit-editable-post').click();
      await expect(adminPage.getByTestId('post-edit-modal')).toBeVisible();
      // slug should be prefilled + readonly; title should be prefilled and editable
      const slugInput = adminPage.getByTestId('post-field-slug');
      await expect(slugInput).toHaveValue('editable-post');
      await expect(slugInput).toBeDisabled();
      const titleInput = adminPage.getByTestId('post-field-title');
      await expect(titleInput).toHaveValue('Original title');
      await titleInput.fill('Updated title');
      await adminPage.getByTestId('post-edit-submit').click();
      await expect(adminPage.getByTestId('post-edit-modal')).toBeHidden({ timeout: 5_000 });

      await goto(page, '/blog/editable-post');
      await expect(page.getByTestId('blog-article-title')).toHaveText('Updated title');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('blog: infinite scroll', () => {
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

interface PostMetaInput {
  slug: string;
  title: string;
  excerpt: string;
  cover: { headline: string; sub: string; hue: 'amber' | 'violet' | 'acid' };
  tags: string;
}

// fillPostMeta —— 填表单的非 body 部分。body 单独走 typeInEditor /
// pickSlashItem，因为 Tiptap 是 contenteditable 不能 .fill()。
async function fillPostMeta(page: Page, input: PostMetaInput): Promise<void> {
  await page.getByRole('button', { name: /new post/i }).click();
  await page.getByTestId('post-field-slug').fill(input.slug);
  await page.getByTestId('post-field-title').fill(input.title);
  await page.getByTestId('post-field-excerpt').fill(input.excerpt);
  await page.getByTestId('post-field-cover-headline').fill(input.cover.headline);
  await page.getByTestId('post-field-cover-sub').fill(input.cover.sub);
  await page.getByTestId('post-field-cover-hue').selectOption(input.cover.hue);
  await page.getByTestId('post-field-tags').fill(input.tags);
}

// focusEditor —— 一次性 click 进 contenteditable，之后键盘 / 输入靠
// page.keyboard，不再 click 否则 cursor 会被搬走。
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('post-field-body').click();
}

async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

async function newLine(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
}

// pickSlashItem —— 输 `/` 等 slash menu 出现，点对应 item，等菜单收起。
// 等收起是必须的：菜单 click → React 触发 insert() 改 ProseMirror 节点 →
// cursor 进新 block。立刻 type 会有几个字符竞争丢失（菜单还没散）。
async function pickSlashItem(page: Page, itemId: string): Promise<void> {
  await page.keyboard.press('/');
  const menu = page.getByTestId('slash-menu');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`slash-item-${itemId}`).click();
  await expect(menu).toBeHidden({ timeout: 5_000 });
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
