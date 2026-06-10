// writing-tree.spec.ts —— reader sidebar 的 writing 树端点(#43-1/3)。
//
// writing 加了 parent_id 树(贴 reader.html 设计)。MCP writing_create 收
// parent_id 把 post 挂到父下。GET /api/v1/writing-tree 懒加载一层:
//   parent 空 → roots;parent=ID → 直接子。节点 {id,title,slug,has_children,locked}。
//
// ACL 跟 wiki 不同:published 才进树(草稿不进),private(visibility!=public)**仍显示**
// 但标 locked(设计要 show locked 节点)。导航按 slug。
//
// 树(seed):
//   Essays(root,published,public)
//    └─ Sub Post(published,public)
//   Private Post(root,published,private) ← locked
//   Draft Post(root,**未发布**) ← 不进树

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

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
});

// tree —— GET /api/v1/writing-tree[?parent=ID]。
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
}

// createWriting —— MCP writing_create,返回 writing_id。
async function createWriting(
  request: APIRequestContext, token: string, sid: string, args: CreateWritingArgs,
): Promise<string> {
  const w = await callTool<{ writing_id: string }>(
    request, token, sid, 'writing_create', args as unknown as Record<string, unknown>,
  );
  return w.writing_id;
}
