// admin-corpus-trash.spec.ts —— the panel side of the corpus trash (corpus-trash.spec.ts covers the
// MCP face): the delete prompt says where the entry goes, the trash section lists it, and its
// restore button puts it back in the wiki list.
//
// The prompt used to say "This cannot be undone." Once a delete lands in the trash that sentence is
// false, and an owner who believes it never looks for the way back.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'trash-panel@example.com', password: 'correct-horse-battery-staple',
  handle: 'trashpanel', fullName: 'Trash Panel',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let parent = '';

test.describe('admin · a deleted wiki entry waits in the trash and the panel restores it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'trash-panel');
    const sid = await initMCP(request, token);
    parent = (await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Panel Trash Parent', body: 'p' })).id;
    await callTool(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Panel Trash Child', body: 'c', parent_id: parent });
    await request.dispose();
  });

  test('delete → the prompt names the trash → the trash lists it → restore → back in the wiki list',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await gotoAdminSection(page, 'wiki');
      let asked = '';
      page.once('dialog', (d) => {
        asked = d.message();
        void d.accept();
      });
      await page.getByTestId(`wiki-delete-${parent}`).click();
      await expect.poll(() => asked, { timeout: 5_000 }).not.toBe('');
      expect(asked, 'the prompt says where the entry goes and for how long').toMatch(/trash.*90 days/i);
      expect(asked, 'the prompt no longer claims a delete is final').not.toMatch(/cannot be undone/i);
      await expect(page.getByTestId(`wiki-delete-${parent}`)).toHaveCount(0, { timeout: 15_000 });

      await gotoAdminSection(page, 'trash');
      const row = page.getByTestId(`trash-row-${parent}`);
      await expect(row).toContainText('Panel Trash Parent', { timeout: 15_000 });
      await expect(row, 'the row says its child went with it').toContainText('+ 1 child entry');
      await page.getByTestId(`trash-restore-${parent}`).click();
      await expect(row, 'a restored entry leaves the trash').toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('trash-empty')).toBeVisible();

      await gotoAdminSection(page, 'wiki');
      await expect(page.getByTestId(`wiki-delete-${parent}`), 'the entry is back in the wiki list')
        .toBeVisible({ timeout: 15_000 });
    });
});
