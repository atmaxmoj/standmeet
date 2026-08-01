// wiki-list-navigation.spec.ts —— corpus_list 是 wiki 树的**懒加载逐层导航**,不是
// 「后端先 load 最新 50 条再在内存里 grep」。
//
// 现实现的关键不变量:
//   1. corpus_list({}) 列根层;corpus_list({path}) 列该节点的**直接子**(DB 端
//      ListWikiChildren,按 parent_id,不吃 newest-50 窗口)。
//   2. 深链:最先种(最旧)、被 60 个 wide-child 推出 newest-50 的节点,照样能逐层
//      list 下去 + corpus_read 读到 —— 旧的内存 50-cap 实现会**漏**(本测试守这条)。
//   3. 宽子树(>一页):corpus_list({path, page}) 翻页,page0/page1 不相交。
//   4. corpus_read 按树派生 path **跨 tool 调用**(各自新 retriever、seen 空)也能
//      顺树 resolve path→id 读到正文 —— 不依赖同回合 seen 缓存。
//
// 直调 per-tool 端点(POST /sessions/{id}/tools/{name}):被测的就是 tool 的**导航
// 输出本身**(不像 cited 只在 loop 末端落库),所以这是诚实的断言面。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool as mcpCallTool } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'navtree@example.com', password: 'correct-horse-battery-staple',
  handle: 'navtree', fullName: 'Nav Tree Owner',
};
const CODE = 'NAV-001';

// 深链(最先种 → 最旧 → 被 wide-child 推出 newest-50)。
const DEEP_KEYWORD = 'navleafqx';
const ROOT_PATH = 'navtree-root';
const MID_PATH = 'navtree-root/navtree-mid';
const LEAF_PATH = 'navtree-root/navtree-mid/navtree-leaf';
// 宽子树:一个 parent 下 WIDE_COUNT 个子,跨过一页(listPageLimit=50)。
const WIDE_PARENT_PATH = 'wide-parent';
const WIDE_COUNT = 60;
const PAGE_SIZE = 50;

interface ToolResp { ok: boolean; result?: unknown }
interface ListRow { path: string; title: string; genre: string }
interface ReadResult { body?: string; path?: string }

test.describe('corpus_list is lazy per-level wiki-tree navigation, not load-newest-50', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupNavTreeOwner(playwright);
  });

  test('descent: list root → child → grandchild reaches an entry beyond newest-50',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request);

      const roots = await listPaths(request, sess, {});
      expect(roots).toContain(ROOT_PATH);
      expect(roots).toContain(WIDE_PARENT_PATH);

      const lvl1 = await listPaths(request, sess, { path: ROOT_PATH });
      expect(lvl1).toEqual([MID_PATH]);

      const lvl2 = await listPaths(request, sess, { path: MID_PATH });
      expect(lvl2).toEqual([LEAF_PATH]);

      const leafChildren = await listPaths(request, sess, { path: LEAF_PATH });
      expect(leafChildren).toEqual([]); // 叶子:空 → LLM 据此判定到底了

      await request.dispose();
    });

  test('wide subtree: corpus_list pages through a level larger than one page',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await freshSession(request);

      const page0 = await listPaths(request, sess, { path: WIDE_PARENT_PATH, page: 0 });
      const page1 = await listPaths(request, sess, { path: WIDE_PARENT_PATH, page: 1 });

      expect(page0).toHaveLength(PAGE_SIZE);
      expect(page1).toHaveLength(WIDE_COUNT - PAGE_SIZE);
      // 不相交 + title ASC:child-00 在首页,child-59 在次页。
      expect(new Set([...page0, ...page1]).size).toBe(WIDE_COUNT);
      expect(page0).toContain(`${WIDE_PARENT_PATH}/child-00`);
      expect(page1).toContain(`${WIDE_PARENT_PATH}/child-59`);

      await request.dispose();
    });

  test('read-after-list: corpus_read resolves a deep tree path on a fresh session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // 全新 session → 全新 retriever(seen 空、内存窗口里也没有这条旧条目):
      // 只能顺树 resolve path→id 读到,正是「按 meta 读文章」。
      const sess = await freshSession(request);
      const { body } = await callTool(request, sess, 'corpus_read', { path: LEAF_PATH });
      const read = body.result as ReadResult;
      expect(read.path).toBe(LEAF_PATH);
      expect(read.body ?? '').toContain(DEEP_KEYWORD);
      await request.dispose();
    });
});

async function setupNavTreeOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'navtree-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'nav', assumed_role_id: role.id,
  });
  await seedTree(request, csrf);
  await request.dispose();
}

// seedTree —— 深链最先(最旧),再 wide-parent + 60 子,把深链推出 newest-50。
async function seedTree(request: APIRequestContext, csrf: string): Promise<void> {
  const token = await createAPIToken(request, csrf, 'navtree-seed');
  const sid = await initMCP(request, token);
  const rootID = await promote(request, token, sid, 'navtree root', '', 'root node');
  const midID = await promote(request, token, sid, 'navtree mid', rootID, 'mid node');
  await promote(request, token, sid, 'navtree leaf', midID,
    `The ${DEEP_KEYWORD} handshake lives at the bottom of the tree.`);
  const wideID = await promote(request, token, sid, 'wide parent', '', 'wide root');
  for (let i = 0; i < WIDE_COUNT; i += 1) {
    const pad = String(i).padStart(2, '0');
    await promote(request, token, sid, `child ${pad}`, wideID, `wide child ${pad}`);
  }
}

// promote —— corpus.create(raw) + corpus.promote(显式 parent_id),返新 wiki 的 id。path 不传,
// 后端按 parent 链 + pathSegment(title) 树派生。
async function promote(
  request: APIRequestContext, token: string, sid: string,
  title: string, parentID: string, body: string,
): Promise<string> {
  const dump = await mcpCallTool<{ id: string }>(
    request, token, sid, 'corpus.create', { genre: 'raw', body, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = { genre: 'raw', id: dump.id, title };
  if (parentID !== '') args['parent_id'] = parentID;
  const wiki = await mcpCallTool<{ id: string }>(
    request, token, sid, 'corpus.promote', args,
  );
  return wiki.id;
}

async function freshSession(request: APIRequestContext): Promise<VisitorSession> {
  return issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
}

async function listPaths(
  request: APIRequestContext, sess: VisitorSession, args: Record<string, unknown>,
): Promise<string[]> {
  const { body } = await callTool(request, sess, 'corpus_list', args);
  const rows = (body.result as ListRow[]) ?? [];
  return rows.filter((r) => r.genre === 'wiki').map((r) => r.path);
}

async function callTool(
  request: APIRequestContext, sess: VisitorSession,
  toolName: string, args: unknown,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${toolName}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args as object },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}
