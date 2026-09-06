// subjectivity-admin-tree.spec.ts —— /admin/subjectivity renders like wiki: a lazy TREE (with the
// tree/grid toggle), not a flat list. It used to be a flat <ul>; now it uses the same
// CorpusTreeGrid as wiki/output/raw, so a nested self-model shows its hierarchy.
//
// Seeds a parent + child subjectivity note (parent_id), opens the section (default tree view),
// and expands the parent to load the child lazily from /corpus/subjectivity/tree.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'subjtree@example.com', password: 'correct-horse-battery-staple',
  handle: 'subjtree', fullName: 'Subj Tree Owner',
};

let token = '';
let sid = '';
let parentID = '';
let childID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('subjectivity admin view is a tree, like wiki', () => {
  test.beforeAll(async ({ playwright }) => { await seed(playwright); });

  test('the section shows the tree/grid toggle and expands a parent to its child',
    async ({ adminPage: page }) => {
      await goto(page, '/admin/subjectivity');
      // The wiki-style view has a tree/grid toggle — the old flat <ul> had none.
      await expect(page.getByTestId('corpus-view-toggle'),
        'subjectivity has the same tree/grid toggle as wiki').toBeVisible({ timeout: 10_000 });
      // The parent loads as a root of the lazy tree.
      const parentRow = page.getByTestId(`subjectivity-row-${parentID}`);
      await expect(parentRow, 'the parent note is a tree root').toBeVisible({ timeout: 10_000 });
      // The child is NOT shown until the parent is expanded (lazy).
      await expect(page.getByTestId(`subjectivity-row-${childID}`),
        'the child is hidden until expand').toHaveCount(0);
      // Expand the parent → the child loads from /corpus/subjectivity/tree.
      await page.getByTestId(`tree-toggle-subjectivity-row-${parentID}`).click();
      await expect(page.getByTestId(`subjectivity-row-${childID}`),
        'expanding the parent lazy-loads the child').toBeVisible({ timeout: 10_000 });
    });
});

async function seed(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'subjtree-seed');
  sid = await initMCP(request, token);
  const parent = await callTool<{ subjectivity_id: string }>(request, token, sid, 'subjectivity_write',
    { title: 'What I distrust', body: 'the self-model root', tags: [] });
  parentID = parent.subjectivity_id;
  const child = await callTool<{ subjectivity_id: string }>(request, token, sid, 'subjectivity_write',
    { title: 'On hype cycles', body: 'a nested take', tags: [], parent_id: parentID });
  childID = child.subjectivity_id;
  await request.dispose();
}
