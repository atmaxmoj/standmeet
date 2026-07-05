// corpus-reparent-path.spec.ts —— 迁移前 gap-fill (🔴#1)。
//
// 移动一个 wiki 节点到新父，它**和它所有后代**的 path 必须跟着更新：旧 path 立刻失效、新 path
// 立刻解析。今天 path 是从 parent_id 树**派生**的，所以这条天然成立。补这个测试是因为结构迁移会
// 把 path **物化**成一列 —— 物化之后「移动节点级联更新后代 path」是最容易漏的一步（改了自己那行、
// 忘了刷后代），而它此前**零守卫**（corpus-tree-integrity 只测了 reparent 成环的**拒绝**，没测成功
// 路径的 path 结果）。这条钉住当前行为，物化实现必须让它继续绿。

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

// promoteWiki —— raw_dump → promote_to_wiki (optional parent) → wiki_id.
async function promoteWiki(
  request: APIRequestContext, token: string, sid: string, title: string, parent?: string,
): Promise<string> {
  const raw = await callTool<{ raw_id: string }>(
    request, token, sid, 'raw_dump', { body: `body of ${title}`, source: 'mcp:e2e', tags: [] });
  const args: Record<string, unknown> = { raw_id: raw.raw_id, title };
  if (parent !== undefined) args['parent_id'] = parent;
  const w = await callTool<{ wiki_id: string }>(request, token, sid, 'promote_to_wiki', args);
  return w.wiki_id;
}

// reparentWiki —— update_wiki changing parent_id (keeps title/body).
async function reparentWiki(
  request: APIRequestContext, token: string, sid: string,
  wikiID: string, title: string, parentID: string,
): Promise<void> {
  await callTool<{ id: string }>(request, token, sid, 'update_wiki', {
    wiki_id: wikiID, title, body: `body of ${title}`, tags: [], parent_id: parentID,
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
