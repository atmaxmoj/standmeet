// wiki-tree-scale.spec.ts —— the public wiki tree endpoint must be truly lazy over the
// **entire** corpus, not "the backend loads ListByOwner(50) first, then slices a layer out of
// memory."
//
// The old implementation loaded the newest-50 and filtered on every `?parent=` call → any
// node past the 51st (or the oldest ones) **silently vanished** from the sidebar. This case
// seeds one deep chain **first** (so it's the oldest), then floods in 55 filler roots to push
// it out of the newest-50, then:
//   - anonymous GET /wiki-tree            → roots still include this old root
//   - anonymous GET /wiki-tree?parent=oldRoot → its children are still reachable
// The old 50-cap implementation **misses** both of these (that's what this test guards);
// it's green once the DB side switches to ListChildren.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { publishEntry } from '@/fixtures/corpus';

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
  // Seeding takes 136 serial `/mcp` round trips (each node = corpus.create + corpus.promote);
  // measured wall clock is **27.0 seconds** (full run on 2026-08-02:
  // 19:23:44.477→19:24:11.004, 12.08s server-side, the rest is per-call HTTP + JSON-RPC
  // overhead). The default 30s hook budget sits right on this line, and will flip in a full run.
  //
  // **Seeding is not made concurrent**: these assertions are exactly about "nothing past the
  // 51st entry may vanish," and the candidate set is ordered by created_at — going concurrent
  // would scramble the seeding order, which changes the very thing under test rather than
  // just speeding it up.
  test.describe.configure({ timeout: 180_000 });

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

    // The old chain is seeded first (so it's oldest), indexed.
    oldRootID = await promote(request, sid, OLD_ROOT_TITLE);
    const oldChildID = await promote(request, sid, OLD_CHILD_TITLE, oldRootID);
    await markIndexed(request, sid, oldRootID);
    await markIndexed(request, sid, oldChildID);
    // 55 filler roots (indexed), pushing the old chain out of the newest-50.
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
      expect(old?.has_children).toBe(true); // peek computes live: it does have a visible child
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

async function markIndexed(
  request: APIRequestContext, sid: string, wikiID: string,
): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
