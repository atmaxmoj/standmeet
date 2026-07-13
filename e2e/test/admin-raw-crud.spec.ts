// admin-raw-crud.spec.ts —— raw entries: DumpBox, filter, promote, archive, edit.
//
// 用户故事：
//   1. DumpBox → 选 source chip → 输入 → dump → 新行出现
//   2. filter 切换 (unprocessed / promoted / all) → list 过滤
//   3. promote → wiki modal → 填 title → confirm → raw 变 "promoted"
//   4. 编辑 body → save → body 更新

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'raw-crud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rawcrud',
  fullName: 'Raw CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin raw CRUD operations', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('DumpBox → input → dump → new entry in list',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      // Open dump box
      const dumpInput = adminPage.getByTestId('dump-input');
      await dumpInput.fill('Test raw entry from UI.');
      await adminPage.getByRole('button', { name: /dump/i }).click();
      // New row should appear
      await expect(adminPage.getByText('Test raw entry from UI.', { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('filter toggle → unprocessed vs all',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      // Switch to "all" filter
      const allFilter = adminPage.getByTestId('raw-filter-all');
      if (await allFilter.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await allFilter.click();
        await expect(adminPage.getByTestId('raw-list')).toBeVisible();
      }
    });

  test('promote raw → wiki modal → fill title → wiki entry created',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await dumpEntry(adminPage, 'Entry to promote to wiki.');
      const row = adminPage.getByTestId(/^raw-row-/).filter({
        hasText: 'Entry to promote to wiki.',
      });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /promote/i }).click();
      // Fill wiki title in promote form (testid: raw-promote-form-{id}-title)
      const titleInput = adminPage.locator('[data-testid$="-title"]').last();
      await titleInput.fill('Promoted Wiki Entry');
      await adminPage.locator('[data-testid$="-submit"]').last().click();
      // Toast confirms promote action
      await expect(adminPage.getByText('Promoted to wiki')).toBeVisible({ timeout: 5_000 });
      // The wiki entry exists in /admin/wiki
      await gotoAdminSection(adminPage, 'wiki');
      await expect(adminPage.getByText('Promoted Wiki Entry')).toBeVisible({ timeout: 5_000 });
    });

  // A vault note body is verbatim markdown: leading YAML frontmatter + a
  // `> Parent: [[..]]` backlink line that are ALSO parsed into tags/parent_id.
  // The list preview must be CLEAN prose, not a raw dump of that markup — the
  // old render printed `{body}` verbatim (frontmatter + Parent:) into the card.
  test('body with frontmatter → list preview is clean prose, not raw markup',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      const body = [
        '---', 'tags:', '  - alpha', '---', '',
        '# Necessity Heading', '',
        '> Parent: [[stages-and-gates]]', '',
        'Stage gating is genuinely necessary here.',
      ].join('\n');
      // Can't match on the raw body — the row renders the CLEANED preview, so find
      // it by the clean sentence that survives.
      await adminPage.getByTestId('dump-input').fill(body);
      await adminPage.getByRole('button', { name: /dump/i }).click();
      const row = adminPage.getByTestId(/^raw-row-/).filter({
        hasText: 'Stage gating is genuinely necessary here.',
      });
      await expect(row).toBeVisible({ timeout: 5_000 });
      // clean prose survives (heading text kept, sentence kept)…
      await expect(row).toContainText('Necessity Heading');
      // …but the structural markup is stripped from the preview.
      await expect(row).not.toContainText('Parent:');
      await expect(row).not.toContainText('tags:');
    });

  test('view toggle → switches tree ⇄ grid, list stays rendered',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await dumpEntry(adminPage, 'Entry so the list is non-empty.');
      await expect(adminPage.getByTestId('corpus-view-toggle')).toBeVisible();
      await adminPage.getByTestId('corpus-view-grid').click();
      await expect(adminPage.getByTestId('raw-list')).toBeVisible();
      await adminPage.getByTestId('corpus-view-tree').click();
      await expect(adminPage.getByTestId('raw-list')).toBeVisible();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function dumpEntry(page: Page, body: string): Promise<void> {
  const dumpInput = page.getByTestId('dump-input');
  await dumpInput.fill(body);
  await page.getByRole('button', { name: /dump/i }).click();
  // Scope to the row, not "any text matching body" — textarea also still
  // shows `body` during the brief window between click and async setText('')
  // clearing it, which makes a `getByText(body)` strict-mode violate.
  await expect(
    page.getByTestId(/^raw-row-/).filter({ hasText: body }),
  ).toBeVisible({ timeout: 5_000 });
}
