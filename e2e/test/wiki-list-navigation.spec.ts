// wiki-list-navigation.spec.ts —— corpus_list is **lazy, per-level navigation**
// of the wiki tree, not "backend loads the newest 50 then greps in memory".
//
// Key invariants of the current implementation:
//   1. corpus_list({}) lists the root level; corpus_list({path}) lists that
//      node's **direct children** (DB-side ListWikiChildren, by parent_id, not
//      subject to the newest-50 window).
//   2. Deep chain: a node seeded first (oldest), pushed out of newest-50 by 60
//      wide-child siblings, can still be reached by listing level by level +
//      read via corpus_read — the old in-memory 50-cap implementation
//      **loses** it (this test guards exactly that).
//   3. Wide subtree (>one page): corpus_list({path, page}) pages through it, page0/page1 don't overlap.
//   4. corpus_read resolving a tree-derived path **across separate tool
//      calls** (each with its own fresh retriever, empty seen set) can still
//      resolve path→id by walking the tree and read the body — it doesn't
//      depend on the same-turn seen cache.
//
// Calls the per-tool endpoint directly (POST /sessions/{id}/tools/{name}):
// what's under test is the tool's **navigation output itself** (unlike cited,
// which only persists at the end of the loop), so this is an honest assertion surface.

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

// Deep chain (seeded first → oldest → pushed out of newest-50 by wide-child siblings).
const DEEP_KEYWORD = 'navleafqx';
const ROOT_PATH = 'navtree-root';
const MID_PATH = 'navtree-root/navtree-mid';
const LEAF_PATH = 'navtree-root/navtree-mid/navtree-leaf';
// Wide subtree: WIDE_COUNT children under one parent, spanning more than one page (listPageLimit=50).
const WIDE_PARENT_PATH = 'wide-parent';
const WIDE_COUNT = 60;
const PAGE_SIZE = 50;

interface ToolResp { ok: boolean; result?: unknown }
interface ListRow { path: string; title: string; genre: string }
interface ReadResult { body?: string; path?: string }

test.describe('corpus_list is lazy per-level wiki-tree navigation, not load-newest-50', () => {
  // Seeding takes 136 serial `/mcp` round trips (each node = corpus.create +
  // corpus.promote); measured wall clock **27.0 seconds**
  // (2026-08-02 full run: 19:23:44.477→19:24:11.004, 12.08s server-side, the
  // rest is per-call HTTP + JSON-RPC overhead). The default 30s hook budget
  // sits right on this line, and reliably tips over under a full run.
  //
  // **Don't parallelize the seeding**: these assertions test exactly "entry
  // 51-and-beyond must not disappear", and the candidate set is ordered by
  // created_at — concurrency would scramble the seed order, which changes
  // what's under test rather than speeding it up.
  test.describe.configure({ timeout: 180_000 });

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
      expect(leafChildren).toEqual([]); // Leaf: empty → the LLM uses this to conclude it has reached the bottom

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
      // No overlap + title ASC: child-00 is on the first page, child-59 is on the second.
      expect(new Set([...page0, ...page1]).size).toBe(WIDE_COUNT);
      expect(page0).toContain(`${WIDE_PARENT_PATH}/child-00`);
      expect(page1).toContain(`${WIDE_PARENT_PATH}/child-59`);

      await request.dispose();
    });

  test('read-after-list: corpus_read resolves a deep tree path on a fresh session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // A brand-new session → a brand-new retriever (empty seen, and the old
      // entry isn't in the in-memory window either): it can only be reached by
      // walking the tree to resolve path→id, which is exactly "read the article by its meta".
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

// seedTree —— seeds the deep chain first (oldest), then a wide-parent + 60 children, pushing the deep chain out of newest-50.
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

// promote —— corpus.create(raw) + corpus.promote(explicit parent_id), returns
// the new wiki's id. path isn't passed; the backend derives it from the
// tree via the parent chain + pathSegment(title).
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
