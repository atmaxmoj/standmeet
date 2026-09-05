// admin-editor-nav-active.spec.ts —— the microsite editor route (/admin/edit/<slug>) must light up
// the **microsites** nav item, not fall through to dashboard.
//
// The gap this closes: nav-page-vs-pages walks the /admin/<slug> entries, but nothing covered the
// editor route — which isn't a slug (it's /admin/edit/<slug>), so adminActiveSlug fell back to
// 'dashboard' and the owner editing a page saw dashboard highlighted (F-N-1's sibling).

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'editor-nav@example.com', password: 'correct-horse-battery-staple',
  handle: 'editornav', fullName: 'Editor Nav Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · the microsite editor highlights microsites, not dashboard', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('on /admin/edit/<slug> the active nav item is microsites', async ({ adminPage: page }) => {
    await goto(page, '/admin/edit/home');
    await expect(page.getByTestId('admin-nav-microsites')).toBeVisible({ timeout: 15_000 });

    // The active nav link carries aria-current="page" (on the <a>, which wraps the testid span).
    // It must be the microsites item, not dashboard.
    const activeLink = page.locator('a[aria-current="page"]');
    await expect(activeLink.getByTestId('admin-nav-microsites'), 'microsites is the lit nav item')
      .toBeVisible();
    await expect(activeLink.getByTestId('admin-nav-dashboard'), 'dashboard is NOT lit on the editor')
      .toHaveCount(0);
  });
});
