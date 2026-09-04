// corpus-reparent-path.spec.ts —— pre-migration gap-fill (🔴#1).
//
// Move a wiki node to a new parent, and the path of it **and all its descendants** must update along with it: the old path
// stops resolving immediately, the new path resolves immediately. Today path is **derived** from the parent_id tree, so this holds
// for free. This test is added because the structural migration will **materialize** path into a column —— once materialized,
// "moving a node cascades the descendants' paths" is the easiest step to miss (changed its own row, forgot to refresh descendants),
// and it had **zero guard** until now (corpus-tree-integrity only tested the **rejection** of a cycling reparent, not the path
// result of the success path). This pins the current behavior; the materialized implementation must keep it green.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'reparent@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'reparent',
  fullName: 'Reparent Owner',
};
const CODE = 'REPARENT-1';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus reparent → derived path cascades to node + descendants', () => {
  let token = '';
  let sess: VisitorSession;
  // A(root) → B → D(grandchild); C(root). Move B under C ⇒ B and D re-path.
  let bID = '';
  let cID = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'reparent-seed');
    const sid = await initMCP(request, token);
    const aID = await promoteWiki(request, token, sid, 'Alpha');
    bID = await promoteWiki(request, token, sid, 'Bravo', aID);
    await promoteWiki(request, token, sid, 'Delta', bID); // grandchild under Bravo
    cID = await promoteWiki(request, token, sid, 'Charlie');
    await createCode(request, csrf, { code: CODE, label: 'reparent' });
    sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
    await request.dispose();
  });

  test('before move: node + grandchild resolve at the original derived paths', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    expect(await visitorRead(request, sess, 'alpha/bravo')).toBe('body of Bravo');
    expect(await visitorRead(request, sess, 'alpha/bravo/delta')).toBe('body of Delta');
    await request.dispose();
  });

  test('after moving Bravo under Charlie: new paths resolve, old paths are gone (descendant cascades)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, token);
      await reparentWiki(request, token, sid, bID, 'Bravo', cID);

      // New paths resolve — the node AND its grandchild re-pathed under the new parent.
      expect(await visitorRead(request, sess, 'charlie/bravo'), 'moved node at new path')
        .toBe('body of Bravo');
      expect(await visitorRead(request, sess, 'charlie/bravo/delta'),
        'grandchild path cascaded under the new parent').toBe('body of Delta');

      // Old paths no longer resolve — no stale address survives the move.
      await expect(visitorRead(request, sess, 'alpha/bravo'),
        'old node path gone').rejects.toThrow();
      await expect(visitorRead(request, sess, 'alpha/bravo/delta'),
        'old grandchild path gone').rejects.toThrow();
      await request.dispose();
    });
});

// promoteWiki —— corpus.create(raw) → corpus.promote(genre:'raw') → the new wiki's id.
async function promoteWiki(
  request: APIRequestContext, token: string, sid: string, title: string, parent?: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, token, sid, 'corpus.create',
    { genre: 'raw', body: `body of ${title}`, source: 'mcp:e2e', tags: [] });
  const args: Record<string, unknown> = { genre: 'raw', id: raw.id, title };
  if (parent !== undefined) args['parent_id'] = parent;
  const w = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', args);
  return w.id;
}

// reparentWiki —— corpus.update changes parent_id (title and body unchanged).
async function reparentWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, title: string, parentID: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title, body: `body of ${title}`,
    tags: [], parent_id: parentID,
  });
}

// visitorRead —— corpus_read {path} → body (throws on deny/not-found).
async function visitorRead(
  request: APIRequestContext, s: VisitorSession, path: string,
): Promise<string> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: { body?: string; error?: string } };
  if (body.result?.error !== undefined) throw new Error(body.result.error);
  return body.result?.body ?? '';
}
