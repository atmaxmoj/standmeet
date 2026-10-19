// writing-tree.spec.ts — the writing-tree endpoint behind the reader sidebar
// (#43-1/3).
//
// writing gained a parent_id tree (following the reader.html design). MCP's
// writing_create accepts parent_id to hang a post under a parent. GET
// /api/v1/writing-tree lazy-loads one level at a time:
//   empty parent → roots; parent=ID → direct children. Node shape:
//   {id,title,slug,has_children,locked}.
//
// ACL differs from wiki: only published entries enter the tree (drafts don't),
// while a private one (visibility!=public) **still shows up** but marked locked
// (the design calls for showing locked nodes). Navigation is by slug.
//
// The seeded tree:
//   Essays (root, published, public)
//    └─ Sub Post (published, public)
//   Private Post (root, published, private) ← locked
//   Draft Post (root, **unpublished**) ← does not enter the tree

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'writingtree@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writingtree',
  fullName: 'Writing Tree Owner',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface WNode { id: string; title: string; slug: string; has_children: boolean; locked: boolean }

const ids: Record<string, string> = {};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('reader writing 树端点:published 进树 + private 显示成 locked', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'writing-tree-seed');
    const sid = await initMCP(request, token);

    ids['essays'] = await createWriting(request, token, sid, {
      slug: 'essays', title: 'Essays', publish: true,
    });
    ids['sub'] = await createWriting(request, token, sid, {
      slug: 'sub-post', title: 'Sub Post', publish: true, parent_id: ids['essays'],
      body_md: 'A paragraph long enough to read down.\n\n'.repeat(80),
    });
    ids['private'] = await createWriting(request, token, sid, {
      slug: 'private-post', title: 'Private Post', publish: true,
      visibility: 'private', locked_body: 'ask for access',
    });
    await createWriting(request, token, sid, {
      slug: 'draft-post', title: 'Draft Post', publish: false,
    });
    await request.dispose();
  });

  test('roots:published 根 = Essays + Private Post(草稿 Draft 不进、子 Sub 不进)',
    async ({ request }) => {
      const roots = await tree(request, '');
      expect(roots.map((n) => n.title).sort()).toEqual(['Essays', 'Private Post']);
    });

  test('懒展开 Essays → Sub Post(slug 导航)', async ({ request }) => {
    const kids = await tree(request, ids['essays'] ?? '');
    expect(kids.map((n) => n.title)).toEqual(['Sub Post']);
    expect(kids[0]?.slug).toBe('sub-post');
  });

  test('private 节点标 locked,public 不标', async ({ request }) => {
    const roots = await tree(request, '');
    expect(roots.find((n) => n.title === 'Private Post')?.locked).toBe(true);
    expect(roots.find((n) => n.title === 'Essays')?.locked).toBe(false);
  });

  test('has_children:Essays 有,Private Post 无', async ({ request }) => {
    const roots = await tree(request, '');
    expect(roots.find((n) => n.title === 'Essays')?.has_children).toBe(true);
    expect(roots.find((n) => n.title === 'Private Post')?.has_children).toBe(false);
  });

  // -- node context (the article page's breadcrumb ancestor chain) --
  test('context:sub-post → 祖先 [Essays]', ctxSubAncestors);

  // -- reader surface: a real browser (/writings tree + the article page's breadcrumb) --
  test('reader sidebar:/writings 懒展开 + private 标 locked', readerSidebar);
  test('reader 文章页:/writings/sub-post breadcrumb 显示祖先 Essays(可点)', articleBreadcrumb);
  test('a laptop-wide window: the tree keeps its own column beside the article', treeBesideArticle);
  test('reading down the article leaves the tree where it was', treeStaysPut);

  // -- admin reparent: prevents a cycle (hanging essays under its own child sub → rejected) --
  test('admin reparent 成环 → 400(essays 挂到子 sub-post 下被拒)', adminReparentCycle);
});

// adminReparentCycle -- an admin PATCH sets essays's parent to its own child
// sub -> a cycle, 400.
async function adminReparentCycle({ request }: { request: APIRequestContext }): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- asserts reparent cycle returns 400 (the negative is the action under test)
  const res = await request.patch(`/api/admin/writings/${ids['essays']}`, {
    headers: { 'X-Csrftoken': csrf },
    multipart: { data: JSON.stringify({ title: 'Essays', parent_id: ids['sub'] }) },
  });
  expect(res.status()).toBe(400);
}

interface TreeContext { ancestors: WNode[]; children: WNode[] }

// ctxSubAncestors -- sub-post's ancestors = [Essays].
async function ctxSubAncestors({ request }: { request: APIRequestContext }): Promise<void> {
  const url = `${BACKEND}/api/v1/writing-tree/context?slug=sub-post`;
  const res = await request.get(url);
  if (!res.ok()) throw new Error(`context ${res.status()}`);
  const ctx = await res.json() as TreeContext;
  expect(ctx.ancestors.map((n) => n.title)).toEqual(['Essays']);
}

// articleBreadcrumb -- /writings/sub-post's top breadcrumb shows the clickable
// ancestor Essays, and the tree sidebar is still present alongside it.
async function articleBreadcrumb({ page }: { page: Page }): Promise<void> {
  await openReader(page, '/writings/sub-post');
  const crumb = page.getByTestId('writing-breadcrumb');
  await expect(crumb).toBeVisible({ timeout: 5_000 });
  await expect(crumb.getByRole('link', { name: 'Essays' })).toBeVisible();
  await expect(page.getByTestId('writing-tree')).toBeVisible();
}

// treeBesideArticle -- at 1300px the tree shows (xl), but the article centred in a 920px column
// left only ~190px of margin for a 240px tree: the article was drawn over it (prod, 2026-10-18).
// The article's left edge stays right of the tree's.
async function treeBesideArticle({ page }: { page: Page }): Promise<void> {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page, '/writings/sub-post');
  const tree = await page.getByTestId('writing-tree').boundingBox();
  const crumb = await page.getByTestId('writing-breadcrumb').boundingBox();
  if (tree === null || crumb === null) throw new Error('tree or breadcrumb not laid out');
  expect(tree.x + tree.width, 'the article starts right of the tree').toBeLessThanOrEqual(crumb.x);
}

// treeStaysPut -- the tree is its own column: reading down the article leaves it where it was
// (prod, 2026-10-18: an unlayered `position: relative` overrode the tree's sticky, and it scrolled
// off with the article).
async function treeStaysPut({ page }: { page: Page }): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openReader(page, '/writings/sub-post');
  const tree = await page.getByTestId('writing-tree').boundingBox();
  if (tree === null) throw new Error('tree not laid out');
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const after = await page.getByTestId('writing-tree').boundingBox();
  expect(after?.y, 'the tree stays put while the article scrolls').toBe(tree.y);
}

// readerSidebar -- /writings displays the writing tree: roots appear; opening
// Essays is what fetches Sub Post (lazily); a private node is marked locked.
async function readerSidebar({ page }: { page: Page }): Promise<void> {
  const treeReqs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/writing-tree')) treeReqs.push(r.url());
  });
  await openReader(page, '/writings');
  await expect(page.getByTestId('writing-tree')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tree-node-essays')).toBeVisible();
  await expect(page.getByTestId('tree-node-private-post')).toBeVisible();
  await expect(page.getByTestId('tree-node-sub-post')).toHaveCount(0);
  expect(treeReqs.some((u) => u.includes('parent='))).toBe(false);
  // The private node is marked locked.
  const locked = page.getByTestId('writing-tree').getByRole('link', { name: 'Private Post' });
  await expect(locked).toHaveAttribute('data-locked', 'true');
  // Open Essays -> only now is Sub Post fetched (lazy loading).
  await page.getByTestId('tree-toggle-essays').click();
  await expect(page.getByTestId('tree-node-sub-post')).toBeVisible({ timeout: 5_000 });
  expect(treeReqs.some((u) => u.includes('parent='))).toBe(true);
}

// tree -- GET /api/v1/writing-tree[?parent=ID].
async function tree(request: APIRequestContext, parentID: string): Promise<WNode[]> {
  const url = parentID === ''
    ? `${BACKEND}/api/v1/writing-tree`
    : `${BACKEND}/api/v1/writing-tree?parent=${parentID}`;
  const res = await request.get(url);
  if (!res.ok()) throw new Error(`writing-tree ${res.status()}`);
  const body = await res.json() as { nodes?: WNode[] };
  return body.nodes ?? [];
}

interface CreateWritingArgs {
  slug: string;
  title: string;
  publish: boolean;
  parent_id?: string;
  visibility?: string;
  locked_body?: string;
  body_md?: string;
}

// createWriting -- calls MCP writing_create, returns the writing_id.
async function createWriting(
  request: APIRequestContext, token: string, sid: string, args: CreateWritingArgs,
): Promise<string> {
  const w = await callTool<{ writing_id: string }>(
    request, token, sid, 'writing_create', args as unknown as Record<string, unknown>,
  );
  return w.writing_id;
}
