// admin-data-store-policy.spec.ts —— the owner sets a page store's rules and approves waiting
// documents from /admin/data (S2, docs/design/scenario-s2-collaborative-writing.md; owner
// 2026-10-02: "默认直接写，我可以config审核").
//
// Driven through the GUI the owner uses: open the page's row, turn review on, set the limit, see a
// visitor's new document marked as waiting, approve it. Each setting is read back from what the
// admin shows after a reload, and the approval from what a visitor can read.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createMicrosite } from '@/fixtures/admin-mutations';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { setStoreWritable, writeStoreDoc } from '@/fixtures/microsite-store';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = { email: 'store-policy@example.com', password: 'correct-horse-battery-staple' };
const SLUG = 'policy-page';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: OWNER });

test.describe.serial('admin · a page store\'s review and limit', () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    api = await playwright.request.newContext();
    await claim(api, findSetupToken(), {
      ...OWNER, handle: 'storepolicy', fullName: 'Store Policy Owner',
    });
  });
  test.afterAll(async () => { await api?.dispose(); });

  test('review on: a new document shows as waiting, and approving it shows it to visitors',
    async ({ adminPage }) => {
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      await createMicrosite(api, csrf, { slug: SLUG, title: 'Policy page' });
      await setStoreWritable(api, csrf, SLUG, true);

      await openRow(adminPage);
      const review = adminPage.getByTestId(`data-review-${SLUG}`);
      await expect(review, 'review starts off').toHaveAttribute('aria-checked', 'false');
      await review.click();
      await expect(review).toHaveAttribute('aria-checked', 'true');

      const got = await writeStoreDoc(api, SLUG, 'passages', { text: 'waits for the owner' });
      expect(got.pending, 'the visitor is told it waits').toBe(true);
      expect(await visitorTexts(), 'visitors do not see it yet').not.toContain('waits for the owner');

      await adminPage.reload();
      await openRow(adminPage);
      await expect(adminPage.getByTestId(`data-review-${SLUG}`), 'review stays on')
        .toHaveAttribute('aria-checked', 'true');
      const row = adminPage.getByTestId(`data-doc-${got.id}`);
      await expect(row.getByTestId('data-doc-pending'), 'marked as waiting').toBeVisible();
      await row.getByTestId(`data-doc-approve-${got.id}`).click();
      await expect(row.getByTestId('data-doc-pending'), 'no longer waiting').toHaveCount(0);
      expect(await visitorTexts(), 'visitors see it once approved').toContain('waits for the owner');
    });

  test('the limit is the owner\'s: set to the current count, the next write is refused',
    async ({ adminPage }) => {
      await openRow(adminPage);
      const limit = adminPage.getByTestId(`data-limit-${SLUG}`);
      await expect(limit, 'the default limit').toHaveValue('500');
      await limit.fill('1');
      await adminPage.getByTestId(`data-limit-save-${SLUG}`).click();
      await adminPage.reload();
      await openRow(adminPage);
      await expect(adminPage.getByTestId(`data-limit-${SLUG}`), 'the limit is kept').toHaveValue('1');
      const res = await api.post(`${BACKEND}/api/v1/pages/${SLUG}/store`,
        { data: { collection: 'passages', doc: { text: 'one too many' } } });
      expect(res.status(), 'the page is full').toBe(429);
    });
});

async function openRow(page: Page): Promise<void> {
  await gotoAdminSection(page, 'data');
  await page.getByTestId(`data-open-${SLUG}`).click();
  await expect(page.getByTestId(`data-store-${SLUG}`)).toBeVisible();
}

async function visitorTexts(): Promise<string> {
  const res = await fetch(`${BACKEND}/api/v1/pages/${SLUG}/store?collection=passages`);
  return JSON.stringify(await res.json());
}
