// corpus-tree-lazy.spec.ts —— the admin corpus tree is LAZY: it fetches one level per
// expanded node, never the whole corpus. Guards the scale-safe contract the owner asked
// for ("this tree must be a lazy tree — you can't load everything at once"):
//   1. on load only the ROOT level is fetched (no ?parent= requests yet);
//   2. a grandchild is not in the DOM and not fetched until its parent is expanded;
//   3. expanding a node fires exactly one request for that node's children.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'lazy-tree@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'lazytree',
  fullName: 'Lazy Tree Owner',
};

let mcpToken = '';
let rootID = '';
let childID = '';
let grandchildID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin corpus lazy tree', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'lazy-tree-seed');
    const sid = await initMCP(request, mcpToken);
    rootID = await promoteWiki(request, mcpToken, sid, 'LazyRoot');
    childID = await promoteWiki(request, mcpToken, sid, 'LazyChild', rootID);
    grandchildID = await promoteWiki(request, mcpToken, sid, 'LazyGrandchild', childID);
    await request.dispose();
  });

  test('loads only the root level; expanding fetches exactly one level',
    async ({ adminPage }) => {
      const treeReqs: string[] = [];
      adminPage.on('request', (r) => {
        const u = r.url();
        if (u.includes('/corpus/wiki/tree')) treeReqs.push(u);
      });

      await gotoAdminSection(adminPage, 'wiki');
      // Default view is tree. Only the root layer loads. (Assert on node testids, not
      // text — the top activity ticker also echoes recent entry titles.)
      await expect(adminPage.getByTestId(`wiki-row-${rootID}`)).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByTestId(`wiki-row-${grandchildID}`)).toHaveCount(0);
      expect(treeReqs.some((u) => !u.includes('parent='))).toBeTruthy(); // roots fetched
      expect(treeReqs.some((u) => u.includes('parent='))).toBeFalsy();   // no deeper layer yet

      // Expand root → exactly its children (LazyChild); grandchild still absent + unfetched.
      await adminPage.getByTestId(`tree-toggle-wiki-row-${rootID}`).click();
      await expect(adminPage.getByTestId(`wiki-row-${childID}`)).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByTestId(`wiki-row-${grandchildID}`)).toHaveCount(0);
      await expect.poll(() => treeReqs.some((u) => u.includes(`parent=${rootID}`))).toBeTruthy();
      expect(treeReqs.some((u) => u.includes(`parent=${childID}`))).toBeFalsy();

      // Expand child → now the grandchild layer loads.
      await adminPage.getByTestId(`tree-toggle-wiki-row-${childID}`).click();
      await expect(adminPage.getByTestId(`wiki-row-${grandchildID}`)).toBeVisible({ timeout: 5_000 });
      await expect.poll(() => treeReqs.some((u) => u.includes(`parent=${childID}`))).toBeTruthy();
    });
});

// promoteWiki —— MCP raw_dump → promote_to_wiki (optionally under a parent), returns the
// new wiki id. Mirrors the seed helper in corpus-tree-integrity.spec.ts.
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
