// wiki-tree-scale.spec.ts —— 公开 wiki 树端点必须真·懒加载**全量**,不是「后端先
// ListByOwner(50) 再在内存里切一层」。
//
// 旧实现每个 ?parent= 调用都 load newest-50 再过滤 → 第 51 条往后(或最旧)的节点
// 在 sidebar 里**静默消失**。这里把一条深链**最先**种下(最旧),再灌 55 条 filler
// root 把它推出 newest-50,然后:
//   - 匿名 GET /wiki-tree            → roots 仍含这条老 root
//   - 匿名 GET /wiki-tree?parent=老root → 仍能展开到它的子
// 旧的 50-cap 实现这两条都会**漏**(本测试守这条);DB 端 ListChildren 后绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'treescale@example.com', password: 'correct-horse-battery-staple',
  handle: 'treescale', fullName: 'Tree Scale Owner',
};
const OLD_ROOT_TITLE = 'Ancient Root';
const OLD_CHILD_TITLE = 'Ancient Child';
const FILLER_ROOTS = 55;

interface TreeNode { id: string; title: string; path: string; has_children: boolean }

let mcpToken = '';
let oldRootID = '';

test.describe('public wiki tree is truly lazy over the whole corpus, not newest-50', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'tree-scale-seed');
    const sid = await initMCP(request, mcpToken);

    // 老链最先种(最旧),indexed。
    oldRootID = await promote(request, sid, OLD_ROOT_TITLE);
    const oldChildID = await promote(request, sid, OLD_CHILD_TITLE, oldRootID);
    await markIndexed(request, sid, oldRootID);
    await markIndexed(request, sid, oldChildID);
    // 55 条 filler root(indexed),把老链推出 newest-50。
    for (let i = 0; i < FILLER_ROOTS; i += 1) {
      const id = await promote(request, sid, `Filler Root ${i}`);
      await markIndexed(request, sid, id);
    }
    await request.dispose();
  });

  test('anon roots include a root seeded before 55 others (no newest-50 cap)',
    async ({ request }) => {
      const roots = await tree(request, '');
      expect(roots.map((n) => n.title)).toContain(OLD_ROOT_TITLE);
      const old = roots.find((n) => n.title === OLD_ROOT_TITLE);
      expect(old?.has_children).toBe(true); // peek 现算:它有可见子
    });

  test('anon expand the old root → its child is still reachable',
    async ({ request }) => {
      const kids = await tree(request, oldRootID);
      expect(kids.map((n) => n.title)).toEqual([OLD_CHILD_TITLE]);
      expect(kids[0]?.path).toBe('ancient-root/ancient-child');
    });
});

async function tree(request: APIRequestContext, parentID: string): Promise<TreeNode[]> {
  const url = parentID === ''
    ? `${BACKEND}/api/v1/wiki-tree`
    : `${BACKEND}/api/v1/wiki-tree?parent=${parentID}`;
  const res = await request.get(url);
  if (!res.ok()) throw new Error(`wiki-tree ${res.status()}`);
  const body = await res.json() as { nodes?: TreeNode[] };
  return body.nodes ?? [];
}

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

async function markIndexed(
  request: APIRequestContext, sid: string, wikiID: string,
): Promise<void> {
  await callTool<unknown>(request, mcpToken, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID, seo_description: '', seo_indexed: true,
  });
}
