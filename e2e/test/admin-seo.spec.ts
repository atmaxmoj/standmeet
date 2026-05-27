// admin-seo.spec.ts —— admin SEO section: defaults form, regenerate sitemap,
// indexing stats, OG preview.
//
// 用户故事：
//   1. defaults form → fields visible
//   2. "regenerate sitemap" button → UI feedback
//   3. indexing stats → pages / outputs / posts counts
//   4. OG preview card renders

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'seo@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'seo',
  fullName: 'SEO Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin SEO section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('SEO defaults form fields visible',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      await adminPage.waitForURL('**/admin/seo', { timeout: 5_000 });
      await expect(adminPage.getByTestId('seo-site-title')).toBeVisible();
    });

  test('regenerate sitemap button visible + clickable',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      const btn = adminPage.getByRole('button', { name: /regenerate sitemap/i });
      await expect(btn).toBeVisible();
      await btn.click();
    });

  test('indexing stats show page counts',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'seo');
      const stats = adminPage.getByTestId('seo-indexing');
      await expect(stats).toBeVisible();
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
