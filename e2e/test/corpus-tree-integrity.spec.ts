// corpus-tree-integrity.spec.ts —— two invariants that come from deriving addresses
// from the tree (the parent chain):
//
//   #14 Delete cascades to children: a document's address comes from its position in
//       the tree, so deleting a node also removes all its descendants (schema
//       parent_id ON DELETE CASCADE). Before an admin delete, the confirm dialog warns
//       how many descendants will go with it. This spec builds a
//       grandparent -> parent -> child three-level tree, deletes the grandparent, and
//       expects parent and child both gone, with a warning count of 2.
//
//   #15 Creation validation: the parent_id given to promote/create must be an entry
//       belonging to this owner; a missing one (or one belonging to another owner) →
//       refused (parent entry not found) — it must never silently create an orphan.

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

// The three-level tree's ids (built in beforeAll, used by #14's grandparent delete
// test) + the owner's MCP token (reused by #15).
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

  // Edge case: re-parenting into a cycle — attaching a node to itself / to its own
  // descendant, refused.
  test('update 把 parent 设成自己 / 自己的子孙 → 拒绝(cycle)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, mcpToken);
      const a = await promoteWiki(request, mcpToken, sid, 'Cycle A');
      const b = await promoteWiki(request, mcpToken, sid, 'Cycle B', a); // B is A's child
      // Attach to itself → cycle.
      await expect(
        reparentWiki(request, mcpToken, sid, a, 'Cycle A', a),
      ).rejects.toThrow(/cycle/i);
      // Attach to its own descendant B → cycle.
      await expect(
        reparentWiki(request, mcpToken, sid, a, 'Cycle A', b),
      ).rejects.toThrow(/cycle/i);
      await request.dispose();
    });

  // Edge case: renaming doesn't affect a citation (references go by id, so after a
  // rename the transcript shows the new name; id and name are orthogonal).
  test('读 entry → 改名 → admin transcript 的 citation 仍解析,显新名', renameKeepsCitation);

  // Edge case: sibling titles colliding on the same slug → the write is refused
  // outright (Obsidian semantics: one directory can't have two files with the same
  // name). Address = a tree-derived slug path, so letting the second one in would
  // break the 1<->1 mapping of path.
  test('兄弟 slug 撞车 → 写时拒绝创建(same name exists),已有那条仍可寻址',
    slugCollisionRejected);
});

// renameKeepsCitation —— reads an entry → renames it → the transcript's cited wiki
// ref (looked up by id) still resolves, and its title is the new name. id and name
// aren't coupled.
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

  // A visitor asks → registers a mock read of this entry → cited_wiki_ids = [wikiID].
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

// slugCollisionRejected —— two root titles ('Foo Bar' / 'Foo-Bar') both slug down to
// "foo-bar". The first is created fine; the second is refused right at write time
// (addresses must be 1<->1, never silently renamed/merged). The one that already
// exists is still addressable at 'foo-bar' and returns its own body — the refusal
// leaves the first-comer untouched.
async function slugCollisionRejected({ playwright }: { playwright: Playwright }): Promise<void> {
  const request = await playwright.request.newContext();
  const sid = await initMCP(request, mcpToken);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await promoteWiki(request, mcpToken, sid, 'Foo Bar');
  // A slug collision under the same parent (root) → refused with a friendly error
  // (not a stack trace).
  await expect(
    promoteWiki(request, mcpToken, sid, 'Foo-Bar'),
  ).rejects.toThrow(/same name already exists/i);
  await createCode(request, csrf, { code: SLUG_CODE, label: 'slug' });

  const sess = await issueSession(request, {
    handle: OWNER.handle, code: SLUG_CODE, visitor_name: 'V',
  });
  // The first-comer is still addressable, and 'foo-bar-2' should not exist (the
  // second entry was never created).
  expect(await visitorRead(request, sess, 'foo-bar')).toBe('body of Foo Bar');
  await expect(visitorRead(request, sess, 'foo-bar-2')).rejects.toThrow();
  await request.dispose();
}

// visitorRead —— the visitor tool endpoint corpus_read, returning the entry body
// (throws on unauthorized/not-found).
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

// deleteGrandparentCascades —— #14: admin deletes the grandparent → confirm warns of
// 2 descendants → the cascade (DB ON DELETE CASCADE) removes parent + child together.
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

  // Delete the grandparent: catch the confirm dialog, record its message, accept it.
  let dialogMsg = '';
  adminPage.once('dialog', (d) => {
    dialogMsg = d.message();
    void d.accept();
  });
  await adminPage.getByTestId(`wiki-delete-${grandparentID}`).click();
  await expect.poll(() => dialogMsg).toContain('2 child entries');

  // The cascade is DB behavior. Reload to get the latest state: all three rows —
  // grandparent, parent, child — are gone.
  await adminPage.reload();
  await expect(adminPage.getByTestId(`wiki-row-${grandparentID}`)).toHaveCount(0, {
    timeout: 5_000,
  });
  await expect(adminPage.getByTestId(`wiki-row-${parentID}`)).toHaveCount(0);
  await expect(adminPage.getByTestId(`wiki-row-${childID}`)).toHaveCount(0);
}

// promoteWiki —— corpus.create(raw) -> corpus.promote (optionally attaching a
// parent), returning the new wiki entry's id. When parent_id is invalid,
// promote_to_wiki throws (callTool surfaces the tool error).
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

// reparentWiki —— corpus.update changes parent_id (callTool throws a tool error when
// this would create a cycle).
async function reparentWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, title: string, parentID: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title, body: `body of ${title}`,
    tags: [], parent_id: parentID,
  });
}

// renameWiki —— corpus.update changes only the title (body/tags are placeholders).
async function renameWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, newTitle: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: newTitle, body: 'body after rename', tags: [],
  });
}

interface CitedRef { id: string; title: string }

// fetchCitedWikiRefs —— the admin transcript's wiki_refs (looked up by
// cited_wiki_ids, carrying the current title).
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
