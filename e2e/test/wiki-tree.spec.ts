// wiki-tree.spec.ts — the public wiki tree endpoint (lazy-loading + ACL filtering).
// Keystone for #37/#43.
//
// The tree is what drives sidebar navigation (used by both the wiki and reader
// surfaces). It returns one level per call (lazy-loading):
//   GET /api/v1/wiki-tree            -> roots
//   GET /api/v1/wiki-tree?parent=ID  -> ID's direct children
// Nodes are {id,title,path,has_children}.
//
// ACL (the owner's ruling): with a code, scope follows the code's role; without a code,
// only published entries — an entry outside scope **does not appear at all**
// (its gated title never leaks).
//
// The tree (seed):
//   Thinking (root, indexed)
//    ├─ Lucerna (indexed)
//    └─ Private Sub (NOT indexed)
//   Fundraising (root, NOT indexed) ← gated
//    └─ Cap Table (NOT indexed)
//   Essays (root, indexed)
//
// An anonymous visitor sees Thinking/Essays (+ Lucerna), but not Fundraising/Private Sub.
// A visitor holding a code (role scoped only to wiki://fundraising**) sees
// Fundraising/Cap Table, but not Thinking/Essays.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import { publishEntry } from '@/fixtures/corpus';

const OWNER = {
  email: 'treeowner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'treeowner',
  fullName: 'Tree Owner',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const GATED_CODE = 'GATED-1';

interface TreeNode { id: string; title: string; path: string; has_children: boolean }

const ids: Record<string, string> = {};
let mcpToken = '';
let csrfToken = '';
let gatedToken = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('公开 wiki 树端点:懒加载一层 + ACL 过滤', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    csrfToken = csrf;
    mcpToken = await createAPIToken(request, csrf, 'tree-seed');
    const sid = await initMCP(request, mcpToken);

    ids['thinking'] = await promote(request, sid, 'Thinking');
    ids['lucerna'] = await promote(request, sid, 'Lucerna', ids['thinking']);
    ids['privSub'] = await promote(request, sid, 'Private Sub', ids['thinking']);
    ids['fund'] = await promote(request, sid, 'Fundraising');
    ids['cap'] = await promote(request, sid, 'Cap Table', ids['fund']);
    ids['essays'] = await promote(request, sid, 'Essays');
    // Indexed Orphan — indexed itself, but filed under Fundraising, which is gated (not
    // indexed). Filesystem-style cascade: a gated parent -> it's also invisible (never
    // promoted to root). The old "promote orphans to root" behavior would have missed this case.
    ids['orphan'] = await promote(request, sid, 'Indexed Orphan', ids['fund']);

    // Mark as indexed: Thinking / Lucerna / Essays / Indexed Orphan (Fundraising is not marked).
    await markIndexed(request, sid, ids['thinking']);
    await markIndexed(request, sid, ids['lucerna']);
    await markIndexed(request, sid, ids['essays']);
    await markIndexed(request, sid, ids['orphan']);

    // A gated session: role scoped only to wiki://fundraising** (covering the root + its
    // descendants).
    gatedToken = await issueGatedSession(request);
    await request.dispose();
  });

  test('匿名:roots 只 indexed —— 见 Thinking/Essays,无 Fundraising', async ({ request }) => {
    const roots = await tree(request, '', null);
    expect(roots.map((n) => n.title).sort()).toEqual(['Essays', 'Thinking']);
  });

  test('匿名:懒展开 Thinking → 只 Lucerna(Private Sub 不 indexed,缺席)',
    async ({ request }) => {
      const kids = await tree(request, ids['thinking'] ?? '', null);
      expect(kids.map((n) => n.title)).toEqual(['Lucerna']);
    });

  test('匿名:has_children —— Thinking 有,Essays 无(无 indexed 子)',
    async ({ request }) => {
      const roots = await tree(request, '', null);
      expect(roots.find((n) => n.title === 'Thinking')?.has_children).toBe(true);
      expect(roots.find((n) => n.title === 'Essays')?.has_children).toBe(false);
    });

  test('匿名:节点 path 是树派生,跟 landing 同口径(thinking/lucerna)',
    async ({ request }) => {
      const kids = await tree(request, ids['thinking'] ?? '', null);
      expect(kids[0]?.path).toBe('thinking/lucerna');
    });

  // Filesystem-style cascade: a gated parent -> the whole subtree is invisible, and an
  // indexed child is never promoted to root either.
  test('cascade ACL:gated parent 下的 indexed 子不可见、不升根',
    async ({ request }) => {
      const roots = await tree(request, '', null);
      expect(roots.map((n) => n.title).sort()).toEqual(['Essays', 'Thinking']);
      expect(roots.map((n) => n.title)).not.toContain('Indexed Orphan');
    });

  test('持 code(role 仅 scope fundraising):roots 见 Fundraising,无 Thinking/Essays',
    async ({ request }) => {
      const roots = await tree(request, '', gatedToken);
      expect(roots.map((n) => n.title)).toEqual(['Fundraising']);
    });

  test('持 code:懒展开 Fundraising → Cap Table + Indexed Orphan(scope 内,gate 已开)',
    async ({ request }) => {
      const kids = await tree(request, ids['fund'] ?? '', gatedToken);
      expect(kids.map((n) => n.title).sort()).toEqual(['Cap Table', 'Indexed Orphan']);
    });

  // ── node context (breadcrumb ancestor chain + SubEntriesRail children) ──
  test('context:匿名 thinking/lucerna → 祖先 [Thinking]、无子', ctxLucernaAncestors);
  test('context:匿名 thinking → 无祖先、子 [Lucerna](Private Sub 不 indexed)', ctxThinkingChildren);
  test('context:持 code fundraising/cap-table → 祖先 [Fundraising]', ctxGatedAncestors);

  // ── the LazyTree component: real-browser behavior (collapsed by default + fetch only
  // on expand + ACL) ──
  test('sidebar:默认合上,点 ▸ 才 fetch 这层 children(懒加载)', sidebarLazyExpand);
  test('sidebar:ACL —— 匿名树里没有 Fundraising(gated root 不泄露)', sidebarAclHidesGated);
  test('breadcrumb:lucerna landing 顶部显示祖先 Thinking(可点)', breadcrumbShowsAncestor);
});

// sidebarLazyExpand — a node not on the current path is collapsed by default, fetching
// its level only when expanded (lazy-loading, never pre-fetching the whole tree).
// Landing on /wiki/essays: Essays is the current entry (auto-expanded, but has no
// children), while Thinking is not on the current path -> collapsed by default; this
// verifies its children are only lazily fetched when its ▸ is clicked.
async function sidebarLazyExpand({ page }: { page: Page }): Promise<void> {
  const treeReqs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/wiki-tree')) treeReqs.push(r.url());
  });
  // the tree rail is display:none below 1500px (reader-shell design c215f0be).
  await page.setViewportSize({ width: 1512, height: 900 });
  await goto(page, '/wiki/essays');
  await expect(page.getByTestId('wiki-tree')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tree-node-thinking')).toBeVisible();
  await expect(page.getByTestId('tree-node-essays')).toBeVisible();
  // Thinking is collapsed by default -> its child (Lucerna) is not in the DOM, and was
  // not pre-fetched.
  await expect(page.getByTestId('tree-node-thinking/lucerna')).toHaveCount(0);
  const thinkingID = ids['thinking'] ?? '';
  expect(treeReqs.some((u) => u.includes(`parent=${thinkingID}`))).toBe(false);
  // Click Thinking's ▸ -> only now does parent=<thinking> get sent -> Lucerna appears.
  await page.getByTestId('tree-toggle-thinking').click();
  await expect(page.getByTestId('tree-node-thinking/lucerna')).toBeVisible({ timeout: 5_000 });
  expect(treeReqs.some((u) => u.includes(`parent=${thinkingID}`))).toBe(true);
}

// sidebarAclHidesGated — a gated root does not appear at all in the anonymous tree (its
// title never leaks).
async function sidebarAclHidesGated({ page }: { page: Page }): Promise<void> {
  await page.setViewportSize({ width: 1512, height: 900 });
  await goto(page, '/wiki/thinking');
  await expect(page.getByTestId('wiki-tree')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tree-node-thinking')).toBeVisible();
  await expect(page.getByTestId('tree-node-fundraising')).toHaveCount(0);
}

// tree — GET /api/v1/wiki-tree[?parent=ID]; carries Bearer when token is non-null (code scope).
async function tree(
  request: APIRequestContext, parentID: string, token: string | null,
): Promise<TreeNode[]> {
  const url = parentID === ''
    ? `${BACKEND}/api/v1/wiki-tree`
    : `${BACKEND}/api/v1/wiki-tree?parent=${parentID}`;
  const headers = token !== null ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await request.get(url, headers ? { headers } : {});
  if (!res.ok()) throw new Error(`wiki-tree ${res.status()}`);
  const body = await res.json() as { nodes?: TreeNode[] };
  return body.nodes ?? [];
}

interface TreeContext { ancestors: TreeNode[]; children: TreeNode[] }

// ctxLucernaAncestors — anonymous, at lucerna: ancestors [Thinking] (both indexed), no children.
async function ctxLucernaAncestors({ request }: { request: APIRequestContext }): Promise<void> {
  const ctx = await context(request, 'thinking/lucerna', null);
  expect(ctx.ancestors.map((n) => n.title)).toEqual(['Thinking']);
  expect(ctx.children).toEqual([]);
}

// ctxThinkingChildren — anonymous, at thinking: no ancestors, children [Lucerna]
// (Private Sub is not indexed).
async function ctxThinkingChildren({ request }: { request: APIRequestContext }): Promise<void> {
  const ctx = await context(request, 'thinking', null);
  expect(ctx.ancestors).toEqual([]);
  expect(ctx.children.map((n) => n.title)).toEqual(['Lucerna']);
}

// ctxGatedAncestors — holding a code: fundraising/cap-table's ancestors are [Fundraising].
async function ctxGatedAncestors({ request }: { request: APIRequestContext }): Promise<void> {
  const ctx = await context(request, 'fundraising/cap-table', gatedToken);
  expect(ctx.ancestors.map((n) => n.title)).toEqual(['Fundraising']);
}

// context — GET /api/v1/wiki-tree/context?path=...; carries Bearer when token is non-null.
async function context(
  request: APIRequestContext, path: string, token: string | null,
): Promise<TreeContext> {
  const url = `${BACKEND}/api/v1/wiki-tree/context?path=${encodeURIComponent(path)}`;
  const headers = token !== null ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await request.get(url, headers ? { headers } : {});
  if (!res.ok()) throw new Error(`context ${res.status()}`);
  return await res.json() as TreeContext;
}

// breadcrumbShowsAncestor — the breadcrumb at the top of the lucerna landing page shows a
// link to its ancestor, Thinking.
async function breadcrumbShowsAncestor({ page }: { page: Page }): Promise<void> {
  await goto(page, '/wiki/thinking/lucerna');
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
  const crumb = page.getByTestId('wiki-breadcrumb');
  await expect(crumb).toBeVisible();
  await expect(crumb.getByRole('link', { name: 'Thinking' })).toBeVisible();
}

// issueGatedSession — creates a role (corpus_uris=['wiki://fundraising**']) + a code +
// issues a session, returning session_token. Called once from beforeAll.
async function issueGatedSession(request: APIRequestContext): Promise<string> {
  const role = await createRole(request, csrfToken, {
    name: 'Fundraising', corpus_uris: ['wiki://fundraising**'],
  });
  await createCode(request, csrfToken, {
    code: GATED_CODE, label: 'gated', assumed_role_id: role.id,
  });
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: GATED_CODE, visitor_name: 'V',
  });
  return sess.session_token;
}

// promote — corpus.create(raw) -> corpus.promote (can attach a parent), returns the new
// wiki's id.
async function promote(
  request: APIRequestContext, sid: string, title: string, parent?: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.create',
    { genre: 'raw', body: `body of ${title}`, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = { genre: 'raw', id: raw.id, title };
  if (parent !== undefined) args['parent_id'] = parent;
  const w = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.promote', args,
  );
  return w.id;
}

// markIndexed —— seo.set_wiki_seo(indexed=true)。
async function markIndexed(
  request: APIRequestContext, sid: string, wikiID: string,
): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
