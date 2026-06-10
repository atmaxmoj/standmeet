// wiki-tree.spec.ts —— 公开 wiki 树端点(懒加载 + ACL 过滤)。#37/#43 键石。
//
// 树是 sidebar 导航(wiki + reader 两个 surface 都用)。一次返一层(懒加载):
//   GET /api/v1/wiki-tree            → roots
//   GET /api/v1/wiki-tree?parent=ID  → ID 的直接子节点
// 节点 {id,title,path,has_children}。
//
// ACL(owner 拍板):有 code 按 code 的 role scope,无 code 只 seo_indexed ——
// 不在 scope 的条目**整条不出现**(不泄露 gated 标题)。
//
// 树(seed):
//   Thinking(root,indexed)
//    ├─ Lucerna(indexed)
//    └─ Private Sub(NOT indexed)
//   Fundraising(root,NOT indexed) ← gated
//    └─ Cap Table(NOT indexed)
//   Essays(root,indexed)
//
// 匿名看见 Thinking/Essays(+ Lucerna),看不见 Fundraising/Private Sub。
// 持 code(role 仅 scope wiki://fundraising**)看见 Fundraising/Cap Table,
// 看不见 Thinking/Essays。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

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

    // 标 indexed:Thinking / Lucerna / Essays(Fundraising 分支 + Private Sub 不标)。
    await markIndexed(request, sid, ids['thinking']);
    await markIndexed(request, sid, ids['lucerna']);
    await markIndexed(request, sid, ids['essays']);

    // gated session:role 仅 scope wiki://fundraising**(含 root + 子孙)。
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

  test('持 code(role 仅 scope fundraising):roots 见 Fundraising,无 Thinking/Essays',
    async ({ request }) => {
      const roots = await tree(request, '', gatedToken);
      expect(roots.map((n) => n.title)).toEqual(['Fundraising']);
    });

  test('持 code:懒展开 Fundraising → Cap Table(gated 子,scope 内可见)',
    async ({ request }) => {
      const kids = await tree(request, ids['fund'] ?? '', gatedToken);
      expect(kids.map((n) => n.title)).toEqual(['Cap Table']);
    });

  // ── LazyTree 组件:真浏览器里的行为(默认合上 + 点开才 fetch + ACL)──
  test('sidebar:默认合上,点 ▸ 才 fetch 这层 children(懒加载)', sidebarLazyExpand);
  test('sidebar:ACL —— 匿名树里没有 Fundraising(gated root 不泄露)', sidebarAclHidesGated);
});

// sidebarLazyExpand —— 默认合上 + 点开才取那层(懒加载,不预取整树)。
async function sidebarLazyExpand({ page }: { page: Page }): Promise<void> {
  const treeReqs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/wiki-tree')) treeReqs.push(r.url());
  });
  await goto(page, '/wiki/thinking');
  await expect(page.getByTestId('wiki-tree')).toBeVisible({ timeout: 5_000 });
  // roots 出现;Thinking 的子(Lucerna)默认不在 DOM。
  await expect(page.getByTestId('tree-node-thinking')).toBeVisible();
  await expect(page.getByTestId('tree-node-essays')).toBeVisible();
  await expect(page.getByTestId('tree-node-thinking/lucerna')).toHaveCount(0);
  // 到此只发过 roots 请求(无 parent=),证明没有预取整棵树。
  expect(treeReqs.some((u) => u.includes('parent='))).toBe(false);
  // 点 Thinking 的 ▸ → 这时才发 parent= 请求 → Lucerna 出现。
  await page.getByTestId('tree-toggle-thinking').click();
  await expect(page.getByTestId('tree-node-thinking/lucerna')).toBeVisible({ timeout: 5_000 });
  expect(treeReqs.some((u) => u.includes('parent='))).toBe(true);
}

// sidebarAclHidesGated —— 匿名树整条不出现 gated root(不泄露标题)。
async function sidebarAclHidesGated({ page }: { page: Page }): Promise<void> {
  await goto(page, '/wiki/thinking');
  await expect(page.getByTestId('wiki-tree')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tree-node-thinking')).toBeVisible();
  await expect(page.getByTestId('tree-node-fundraising')).toHaveCount(0);
}

// tree —— GET /api/v1/wiki-tree[?parent=ID];token 非空时带 Bearer(code scope)。
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

// issueGatedSession —— 建 role(corpus_uris=['wiki://fundraising**'])+ code +
// 发 session,返回 session_token。beforeAll 调一次。
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

// promote —— raw_dump → promote_to_wiki(可挂 parent),返回 wiki_id。
async function promote(
  request: APIRequestContext, sid: string, title: string, parent?: string,
): Promise<string> {
  const raw = await callTool<{ raw_id: string }>(
    request, mcpToken, sid, 'raw_dump',
    { body: `body of ${title}`, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = { raw_id: raw.raw_id, title };
  if (parent !== undefined) args['parent_id'] = parent;
  const w = await callTool<{ wiki_id: string }>(
    request, mcpToken, sid, 'promote_to_wiki', args,
  );
  return w.wiki_id;
}

// markIndexed —— seo.set_wiki_seo(indexed=true)。
async function markIndexed(
  request: APIRequestContext, sid: string, wikiID: string,
): Promise<void> {
  await callTool<unknown>(request, mcpToken, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID, seo_description: '', seo_indexed: true,
  });
}
