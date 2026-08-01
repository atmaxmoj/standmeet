// corpus-tree-integrity.spec.ts —— 地址树派生(parent 链)带来的两条不变量:
//
//   #14 删父级联:document 的地址来自它在树里的位置,删一个节点 → 它的全部
//       子孙跟着没(schema parent_id ON DELETE CASCADE)。admin 删除前 confirm
//       警告会连带删几个子孙。本 spec 建 祖父→父→子 三层,删祖父 → 父和子都没,
//       警告数 = 2。
//
//   #15 创建校验:promote/create 给的 parent_id 必须是本 owner 的 entry;不存在
//       (或别 owner)→ 拒绝(parent entry not found),不静默落孤儿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { initMCP, callTool } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createCode } from '@/fixtures/codes';
import { issueSession, sendMessage } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'treeintegrity@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'treeintegrity',
  fullName: 'Tree Integrity Owner',
};

const MISSING_PARENT = '00000000-0000-0000-0000-000000000000';
const RENAME_CODE = 'RENAME-1';
const SLUG_CODE = 'SLUG-1';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// 三层树的 id(beforeAll 建好,#14 测删祖父)+ owner MCP token(#15 复用)。
let grandparentID = '';
let parentID = '';
let childID = '';
let mcpToken = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('corpus 树完整性:删父级联 + 创建校验 parent', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'tree-integrity-seed');
    const sid = await initMCP(request, mcpToken);
    grandparentID = await promoteWiki(request, mcpToken, sid, 'Grandparent');
    parentID = await promoteWiki(request, mcpToken, sid, 'Parent', grandparentID);
    childID = await promoteWiki(request, mcpToken, sid, 'Child', parentID);
    await request.dispose();
  });

  test('删祖父 → 父+子级联一起没;confirm 警告 2 个子孙', deleteGrandparentCascades);

  test('promote 挂不存在的 parent_id → 拒绝(parent entry not found)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, mcpToken);
      await expect(
        promoteWiki(request, mcpToken, sid, 'Orphan attempt', MISSING_PARENT),
      ).rejects.toThrow(/parent entry not found/);
      await request.dispose();
    });

  // 边界:re-parent 成环 —— 把节点挂到自己 / 自己的子孙下,拒绝。
  test('update 把 parent 设成自己 / 自己的子孙 → 拒绝(cycle)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, mcpToken);
      const a = await promoteWiki(request, mcpToken, sid, 'Cycle A');
      const b = await promoteWiki(request, mcpToken, sid, 'Cycle B', a); // B 是 A 的子
      // 挂到自己 → 环。
      await expect(
        reparentWiki(request, mcpToken, sid, a, 'Cycle A', a),
      ).rejects.toThrow(/cycle/i);
      // 挂到自己的子孙 B → 环。
      await expect(
        reparentWiki(request, mcpToken, sid, a, 'Cycle A', b),
      ).rejects.toThrow(/cycle/i);
      await request.dispose();
    });

  // 边界:改名不影响 citation(引用按 id,改名后 transcript 显新名;id⊥name)。
  test('读 entry → 改名 → admin transcript 的 citation 仍解析,显新名', renameKeepsCitation);

  // 边界:兄弟 title slug 撞车 → 写时直接拒(Obsidian 语义:一个目录不能有两个
  // 同名文件)。地址 = 树派生 slug path,放进来第二条就让 path 不再 1↔1。
  test('兄弟 slug 撞车 → 写时拒绝创建(same name exists),已有那条仍可寻址',
    slugCollisionRejected);
});

// renameKeepsCitation —— 读 entry → 改名 → transcript 的 cited wiki ref(按 id
// 反查)仍解析、title 是新名。id 和 name 不耦合。
async function renameKeepsCitation({ playwright }: { playwright: Playwright }): Promise<void> {
  const request = await playwright.request.newContext();
  const sid = await initMCP(request, mcpToken);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // Seed inline (not via promoteWiki) to capture the promote-returned path for the
  // scripted corpus_read below.
  const raw = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.create',
    { genre: 'raw', body: 'body of Quantum ledger notes', source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ id: string; path: string }>(
    request, mcpToken, sid, 'corpus.promote',
    { genre: 'raw', id: raw.id, title: 'Quantum ledger notes' },
  );
  const wikiID = wiki.id;
  await createCode(request, csrf, { code: RENAME_CODE, label: 'rename' });

  // visitor 问 → 注册 mock 读这条 → cited_wiki_ids = [wikiID]。
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: RENAME_CODE, visitor_name: 'V',
  });
  const tag = await scriptMockToolCall(request, {
    name: 'corpus_read', args: { path: wiki.path },
  });
  const stream = await sendMessage(request, sess, `tell me about quantum ledger${tag}`);
  await stream.body();

  await renameWiki(request, mcpToken, sid, wikiID, 'Renamed afterwards');

  const refs = await fetchCitedWikiRefs(request, csrf, sess.conversation_id);
  expect(refs.find((r) => r.id === wikiID)?.title).toBe('Renamed afterwards');
  await request.dispose();
}

// slugCollisionRejected —— 两个 root 的 title('Foo Bar' / 'Foo-Bar')slug 都
// → "foo-bar"。第一条建得下;第二条写时直接被拒(地址要 1↔1,不静默改名/合并)。
// 已存在的那条仍按 'foo-bar' 可寻址、拿到自己的 body —— 拒绝没有污染先到者。
async function slugCollisionRejected({ playwright }: { playwright: Playwright }): Promise<void> {
  const request = await playwright.request.newContext();
  const sid = await initMCP(request, mcpToken);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await promoteWiki(request, mcpToken, sid, 'Foo Bar');
  // 同 parent(root)下 slug 撞车 → 拒绝,友好报错(不是 stack trace)。
  await expect(
    promoteWiki(request, mcpToken, sid, 'Foo-Bar'),
  ).rejects.toThrow(/same name already exists/i);
  await createCode(request, csrf, { code: SLUG_CODE, label: 'slug' });

  const sess = await issueSession(request, {
    handle: OWNER.handle, code: SLUG_CODE, visitor_name: 'V',
  });
  // 先到的那条仍可寻址,且 'foo-bar-2' 不该存在(第二条没建成)。
  expect(await visitorRead(request, sess, 'foo-bar')).toBe('body of Foo Bar');
  await expect(visitorRead(request, sess, 'foo-bar-2')).rejects.toThrow();
  await request.dispose();
}

// visitorRead —— 访客工具端点 corpus_read,返回 entry body(越权/找不到 → 抛)。
async function visitorRead(
  request: APIRequestContext, sess: VisitorSession, path: string,
): Promise<string> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: { body?: string; error?: string } };
  if (body.result?.error !== undefined) throw new Error(body.result.error);
  return body.result?.body ?? '';
}

// deleteGrandparentCascades —— #14:admin 删祖父 → confirm 警告 2 个子孙 →
// 级联(DB ON DELETE CASCADE)父+子一起没。
async function deleteGrandparentCascades({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'wiki');
  // Grid view renders every loaded row flat (the tree view is lazy — parent/child
  // stay collapsed until expanded). This UI test wants all three rows on screen to
  // drive the delete + assert the cascade, so switch to grid.
  await adminPage.getByTestId('corpus-view-grid').click();
  await expect(adminPage.getByTestId(`wiki-row-${grandparentID}`)).toBeVisible({
    timeout: 5_000,
  });
  await expect(adminPage.getByTestId(`wiki-row-${parentID}`)).toBeVisible();
  await expect(adminPage.getByTestId(`wiki-row-${childID}`)).toBeVisible();

  // 删祖父:接住 confirm,记下文案,确认。
  let dialogMsg = '';
  adminPage.once('dialog', (d) => {
    dialogMsg = d.message();
    void d.accept();
  });
  await adminPage.getByTestId(`wiki-delete-${grandparentID}`).click();
  await expect.poll(() => dialogMsg).toContain('2 child entries');

  // 级联是 DB 行为。reload 拿最新态:祖父、父、子三行全没。
  await adminPage.reload();
  await expect(adminPage.getByTestId(`wiki-row-${grandparentID}`)).toHaveCount(0, {
    timeout: 5_000,
  });
  await expect(adminPage.getByTestId(`wiki-row-${parentID}`)).toHaveCount(0);
  await expect(adminPage.getByTestId(`wiki-row-${childID}`)).toHaveCount(0);
}

// promoteWiki —— corpus.create(raw) → corpus.promote(可挂 parent),返回新 wiki 的 id。
// parent_id 无效时 promote_to_wiki 抛(callTool 把 tool error 抛出来)。
async function promoteWiki(
  request: APIRequestContext, token: string, sid: string,
  title: string, parent?: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, token, sid, 'corpus.create',
    { genre: 'raw', body: `body of ${title}`, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = { genre: 'raw', id: raw.id, title };
  if (parent !== undefined) args['parent_id'] = parent;
  const w = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', args,
  );
  return w.id;
}

// reparentWiki —— corpus.update 改 parent_id(成环时 callTool 抛 tool error)。
async function reparentWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, title: string, parentID: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title, body: `body of ${title}`,
    tags: [], parent_id: parentID,
  });
}

// renameWiki —— corpus.update 只改 title(body/tags 占位)。
async function renameWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, newTitle: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: newTitle, body: 'body after rename', tags: [],
  });
}

interface CitedRef { id: string; title: string }

// fetchCitedWikiRefs —— admin transcript 的 wiki_refs(按 cited_wiki_ids 反查、
// 带当前 title)。
async function fetchCitedWikiRefs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<CitedRef[]> {
  const res = await request.get(
    `${BACKEND}/api/admin/conversations/${conversationID}`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  if (!res.ok()) throw new Error(`transcript fetch: ${res.status()}`);
  const body = await res.json() as { wiki_refs?: CitedRef[] };
  return body.wiki_refs ?? [];
}
