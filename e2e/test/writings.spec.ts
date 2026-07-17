// writings.spec.ts —— writings 全链 e2e (formerly blog-posts.spec.ts).
//
// 业务故事：
//   1. owner 在 /admin/writings 用 Tiptap 编辑器写：打字、`/` 唤出 slash menu
//      插入 heading → publish → 访客 /writings 看到 → 文章页渲染出对应结构。
//   2. owner 在 Claude Desktop 让 AI 调 writing_create (publish=true) → 访客
//      /writings 列表也能看到 → 文章页渲染丰富 GFM 特性 (h2 / bold / 列表)。
//      （rich GFM full coverage 落在这里——MCP 路径喂 markdown 是 AI 主要
//      入口，且不依赖编辑器交互能力。）
//   3. infinite scroll：writing_create 灌 13 篇 (default limit 12) → visitor
//      滚到底 → 第 13 条自动 append。
//   4. XSS：markdown 里塞 `<script>` 必须被 escape，不能跑到 DOM 里。
//   5. image upload：owner paste 图片到编辑器 → 上传到 MinIO → markdown
//      存 `standmeet-asset:<id>` URI → /writings 渲染时 backend resolve 成 presigned
//      URL；orphan 扫此时 = 0（asset 有 writing 引用）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import {
  uploadCoverImage, pasteImage, assertAdminBodyHasURI,
} from '@/fixtures/writing-assets';
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
test.describe('writings: editor flow + rich render + XSS', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner types in Tiptap editor + slash menu → /writings renders the structure',
    async ({ adminPage, page }) => {
      await openAdminWritings(adminPage);
      await fillWritingMeta(adminPage, {
        slug: 'editor-flow', title: 'Editor flow',
        excerpt: 'Type prose, slash a heading.',
        cover: { headline: 'editor.', hue: 'amber' },
        tags: 'editor, slash',
      });
      await focusEditor(adminPage);
      await typeText(adminPage, 'First paragraph.');
      await newLine(adminPage);
      await pickSlashItem(adminPage, 'h2');
      await typeText(adminPage, 'A heading');
      await adminPage.getByTestId('writing-create-submit').click();
      await expect(adminPage.getByTestId('writing-row-editor-flow'))
        .toBeVisible({ timeout: 5_000 });

      await goto(page, '/writings');
      await page.locator('a[href="/writings/editor-flow"]').first().click();
      const body = page.getByTestId('writing-article-body');
      await expect(body.locator('h2')).toHaveText('A heading');
      await expect(body.locator('p').first()).toContainText('First paragraph.');
    });

  test('MCP writing_create with full GFM markdown → every feature renders',
    async ({ request, page }) => {
      await mcpCreateWriting(request, 'writing-mcp-token', {
        slug: 'rich-markdown-essay', title: 'Rich markdown essay',
        excerpt: 'Every GFM feature must round-trip cleanly.',
        body_md: RICH_MD,
        cover_headline: 'rich markdown.',
        cover_hue: 'amber', tags: ['markdown', 'gfm'],
      });
      await goto(page, '/writings');
      await page.locator('a[href="/writings/rich-markdown-essay"]').first().click();
      await expect(page.getByTestId('writing-article-title')).toHaveText('Rich markdown essay');
      await assertGFMRendering(page);
    });

  test('XSS: <script> in markdown body is escaped, not executed',
    async ({ request, page }) => {
      await mcpCreateWriting(request, 'writing-xss-token', {
        slug: 'xss-attempt',
        title: 'XSS attempt',
        excerpt: 'Owner-untrusted markdown must not execute.',
        body_md: 'Before.\n\n<script>window.__xssRan = true;</script>\n\nAfter.',
        cover_headline: 'xss.', cover_hue: 'acid',
        tags: ['security'],
      });
      await goto(page, '/writings/xss-attempt');
      await expect(page.getByTestId('writing-article-body').locator('script')).toHaveCount(0);
      const flag = await page.evaluate(() =>
        (window as Window & { __xssRan?: boolean }).__xssRan);
      expect(flag).toBeFalsy();
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('writings: atomic image upload via multipart save', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner uploads cover image → /writings cover renders with image background',
    async ({ adminPage, page, request }) => {
      await openAdminWritings(adminPage);
      await fillWritingMeta(adminPage, {
        slug: 'with-cover', title: 'Writing with cover',
        excerpt: 'Cover image attached.',
        cover: { headline: 'cover.', hue: 'amber' },
        tags: 'cover',
      });
      await uploadCoverImage(adminPage);
      // wait for preview img to appear → upload completed
      await expect(adminPage.getByAltText('cover preview')).toBeVisible({ timeout: 10_000 });
      await adminPage.getByTestId('writing-create-submit').click();
      await expect(adminPage.getByTestId('writing-row-with-cover'))
        .toBeVisible({ timeout: 5_000 });

      // 诊断：confirm writing stored cover_image_asset_id + asset_urls resolved
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const adminRes = await request.get('/api/admin/writings/', { headers: { 'X-Csrftoken': csrf } });
      const adminWritings = await adminRes.json() as Array<{ slug: string; cover_image_asset_id: string; asset_urls: Record<string, string> }>;
      const stored = adminWritings.find((p) => p.slug === 'with-cover');
      expect(stored).toBeTruthy();
      expect(stored?.cover_image_asset_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(stored?.asset_urls ?? {})).toContain(stored?.cover_image_asset_id);

      // confirm public endpoint also resolves asset_urls
      const publicRes = await request.get('/api/v1/writings/with-cover');
      const publicWriting = await publicRes.json() as { cover_image_asset_id: string; asset_urls: Record<string, string> };
      expect(publicWriting.cover_image_asset_id).toBe(stored?.cover_image_asset_id);
      expect(Object.keys(publicWriting.asset_urls ?? {})).toContain(publicWriting.cover_image_asset_id);

      await goto(page, '/writings/with-cover');
      const cover = page.locator('[data-writing-cover]').first();
      const img = cover.locator('img').first();
      const src = await img.getAttribute('src');
      expect(src).toMatch(/localhost(%3A|:)9200/);
      // F-I-1: assert the cover actually LOADS, not just that a URL is present. Next's image
      // optimizer 400s the presigned storage URL (host not in images.remotePatterns), so through
      // /_next/image the cover is a broken image. `unoptimized` serves the presigned URL directly.
      expect(src).not.toContain('/_next/image');
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    });

  test('paste image in editor → save → /writings renders presigned URL; body_md stores URI',
    async ({ adminPage, page, request }) => {
      await openAdminWritings(adminPage);
      await fillWritingMeta(adminPage, {
        slug: 'image-writing', title: 'Writing with image',
        excerpt: 'Owner pastes an image.',
        cover: { headline: 'image.', hue: 'acid' },
        tags: 'image',
      });
      await focusEditor(adminPage);
      await typeText(adminPage, 'See image below.');
      await newLine(adminPage);
      await pasteImage(adminPage, 'pixel.png');
      // wait for img node to appear in editor (paste inserts immediately
      // with blob: URL, server upload happens at submit-time).
      await expect(adminPage.locator('.writing-editor-surface img')).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('writing-create-submit').click();
      await expect(adminPage.getByTestId('writing-row-image-writing'))
        .toBeVisible({ timeout: 10_000 });

      // visitor side: img element with presigned URL
      await goto(page, '/writings/image-writing');
      const img = page.getByTestId('writing-article-body').locator('img').first();
      await expect(img).toBeVisible();
      const src = await img.getAttribute('src');
      expect(src).toMatch(/localhost(%3A|:)9200/); // presigned URL host (minio public)

      // admin GET: body_md contains real asset UUID (not pending-) URI
      await assertAdminBodyHasURI(request, OWNER, 'image-writing');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('writings: edit existing writing', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('owner clicks edit → changes title → /writings reflects new title',
    async ({ request, adminPage, page }) => {
      await mcpCreateWriting(request, 'writing-edit-token', {
        slug: 'editable-writing', title: 'Original title',
        excerpt: 'Will be edited.', body_md: 'Original body.',
        cover_headline: 'first.', cover_hue: 'amber',
        tags: ['edit'],
      });
      await openAdminWritings(adminPage);
      await adminPage.getByTestId('writing-edit-editable-writing').click();
      await expect(adminPage.getByTestId('writing-edit-modal')).toBeVisible();
      // slug should be prefilled + readonly; title should be prefilled and editable
      const slugInput = adminPage.getByTestId('writing-field-slug');
      await expect(slugInput).toHaveValue('editable-writing');
      await expect(slugInput).toBeDisabled();
      const titleInput = adminPage.getByTestId('writing-field-title');
      await expect(titleInput).toHaveValue('Original title');
      await titleInput.fill('Updated title');
      await adminPage.getByTestId('writing-edit-submit').click();
      await expect(adminPage.getByTestId('writing-edit-modal')).toBeHidden({ timeout: 5_000 });

      await goto(page, '/writings/editable-writing');
      await expect(page.getByTestId('writing-article-title')).toHaveText('Updated title');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('writings: infinite scroll', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('13+ writings → scroll loads page 2',
    async ({ request, page }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'writing-scroll-token');
      const sid = await initMCP(request, apiToken);
      await seedExtraWritings(request, apiToken, sid, 13);
      await goto(page, '/writings');
      // order is published_at desc, so newest 13 visible first, oldest
      // (scroll-01) lands on page 2.
      const pageTwo = page.waitForResponse((res) =>
        res.url().includes('/api/v1/writings') && res.url().includes('cursor=')
        && res.status() === 200);
      await page.getByTestId('writings-scroll-sentinel').scrollIntoViewIfNeeded();
      await pageTwo;
      await expect(page.locator('[data-writing-card="scroll-01"]').first())
        .toBeVisible({ timeout: 5_000 });
    });
});

// 设父:editor 的 parent 下拉选了某篇 → 落库 parent_id → reader 公开树里成为子。
test.describe('writings: set parent in editor → reader tree nesting', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('create child with parent selected → child nests under parent',
    async ({ adminPage, request }) => {
      await openAdminWritings(adminPage);
      await fillWritingMeta(adminPage, {
        slug: 'tree-parent', title: 'Tree Parent', excerpt: 'p',
        cover: { headline: 'a', hue: 'amber' }, tags: '',
      });
      await adminPage.getByTestId('writing-create-submit').click();
      await expect(adminPage.getByTestId('writing-row-tree-parent')).toBeVisible({ timeout: 5_000 });

      await fillWritingMeta(adminPage, {
        slug: 'tree-child', title: 'Tree Child', excerpt: 'c',
        cover: { headline: 'a', hue: 'amber' }, tags: '',
      });
      await adminPage.getByTestId('writing-field-parent').selectOption({ label: 'Tree Parent' });
      await adminPage.getByTestId('writing-create-submit').click();

      // 子节点在树里**本来就是折叠的** —— 这条曾经断言它建完直接可见，那不是树该有的行为。
      // 真正该守的是：父节点得**知道自己多了个孩子**（长出展开箭头），展开就能看到。
      // 建的时候不 bump corpus epoch 的话，树的那一层是陈的：箭头不出现、子节点在界面上根本
      // 够不着，而计数已经变成 2 —— owner 看到的是"我刚建的东西不见了"。
      const parentRow = adminPage.getByTestId('writing-row-tree-parent');
      await expect(parentRow).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('tree-toggle-writing-row-tree-parent').click();
      await expect(adminPage.getByTestId('writing-row-tree-child')).toBeVisible({ timeout: 5_000 });

      const parentID = await adminWritingID(request, 'tree-parent');
      const res = await request.get(`/api/v1/writing-tree?parent=${parentID}`);
      const nodes = (await res.json() as { nodes: Array<{ slug: string }> }).nodes;
      expect(nodes.map((n) => n.slug)).toContain('tree-child');
    });
});

// adminWritingID —— admin list 里按 slug 找 writing id。
async function adminWritingID(request: APIRequestContext, slug: string): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.get('/api/admin/writings/', { headers: { 'X-Csrftoken': csrf } });
  const list = await res.json() as Array<{ id: string; slug: string }>;
  const found = list.find((w) => w.slug === slug);
  if (!found) throw new Error(`writing ${slug} not found`);
  return found.id;
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

interface MCPCreateWritingInput {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_headline: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  tags: string[];
}

async function mcpCreateWriting(
  request: APIRequestContext, tokenName: string, in_: MCPCreateWritingInput,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  await callTool<{ writing_id: string }>(request, apiToken, sid, 'writing_create', {
    ...in_, publish: true,
  });
}

async function assertGFMRendering(page: Page): Promise<void> {
  const body = page.getByTestId('writing-article-body');
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

async function openAdminWritings(page: Page): Promise<void> {
  await gotoAdminSection(page, 'writings');
  await page.waitForURL('**/admin/writings');
}

interface WritingMetaInput {
  slug: string;
  title: string;
  excerpt: string;
  cover: { headline: string; hue: 'amber' | 'violet' | 'acid' };
  tags: string;
}

// fillWritingMeta —— 填表单的非 body 部分。body 单独走 typeInEditor /
// pickSlashItem，因为 Tiptap 是 contenteditable 不能 .fill()。
async function fillWritingMeta(page: Page, input: WritingMetaInput): Promise<void> {
  await page.getByRole('button', { name: /new writing/i }).click();
  await page.getByTestId('writing-field-slug').fill(input.slug);
  await page.getByTestId('writing-field-title').fill(input.title);
  await page.getByTestId('writing-field-excerpt').fill(input.excerpt);
  await page.getByTestId('writing-field-cover-headline').fill(input.cover.headline);
  await page.getByTestId('writing-field-cover-hue').selectOption(input.cover.hue);
  await page.getByTestId('writing-field-tags').fill(input.tags);
}

// focusEditor —— 一次性 click 进 contenteditable，之后键盘 / 输入靠
// page.keyboard，不再 click 否则 cursor 会被搬走。
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('writing-field-body').click();
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

async function seedExtraWritings(
  request: APIRequestContext, token: string, sid: string, count: number,
): Promise<void> {
  // sequential HTTP round-trips give natural μs-level stagger on
  // postgres now(); enough to avoid timestamp ties (would break cursor
  // pagination which uses strict `<` on published_at).
  for (let i = 0; i < count; i++) {
    const idx = String(i + 1).padStart(2, '0');
    await callTool(request, token, sid, 'writing_create', {
      slug: `scroll-${idx}`,
      title: `Scroll Writing ${idx}`,
      excerpt: `Test writing ${idx}.`,
      body_md: `Body paragraph ${idx}.`,
      cover_headline: `writing ${idx}.`,
      cover_hue: 'acid',
      tags: ['scroll-test'],
      publish: true,
    });
  }
}
