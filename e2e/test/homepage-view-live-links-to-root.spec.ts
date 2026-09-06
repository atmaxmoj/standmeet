// homepage-view-live-links-to-root.spec.ts —— the microsites list's "view live" link for the
// reserved `home` page must point at `/` (its canonical URL), not `/p/home`.
//
// The `home` page is a microsite pinned to the site root, served at `/` with <base href="/">
// (homepage-served-at-root). The list built EVERY row's live link as `/p/${slug}`, so the homepage
// row's "view live ↗" sent the owner to `/p/home` — the non-canonical address, whose <base> is
// `/p/home/`, and which on a prod instance whose home build was orphaned served a full-page "asset
// not found" (the symptom the owner hit). The homepage's live view belongs at `/`. This guards it.
//
// RED before the fix: the href is `/p/home`.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const HOME_HERO = 'I think out loud here'; // a distinctive line from the DefaultHomepage template

const OWNER = {
  email: 'homeviewlive@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeviewlive', fullName: 'Home ViewLive Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 420_000 });

test.describe('homepage · the microsites list links its live view at `/`', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await loginAPI(request, OWNER.email, OWNER.password);
    // The homepage build is queued at claim and auto-promotes when it finishes — wait for it so the
    // row shows the "view live" link (a page with no live build shows "no live build" instead).
    await expect.poll(
      async () => (await request.get(`${BACKEND}/api/v1/homepage`)).status(),
      { message: 'the home page must go live on its own', timeout: 360_000, intervals: [3000] },
    ).toBe(200);
    await request.dispose();
  });

  test('the homepage card view-live link is `/`, and it serves the homepage (not "asset not found")',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'microsites');
      // The homepage lives in its own card now (not a table row) — its view-live link is there.
      const link = page.locator('[data-testid="microsite-homepage-card"]')
        .getByRole('link', { name: 'view live ↗' });
      await expect(link, 'the homepage card shows a live-view link').toBeVisible({ timeout: 20_000 });

      // The homepage is served at `/`, never /p/home.
      await expect(link, 'home links at the root, not /p/home').toHaveAttribute('href', '/');

      await link.click();
      await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15_000 });
      await expect(page.getByText(HOME_HERO, { exact: false }).first(),
        'the real homepage renders, not the 404').toBeVisible({ timeout: 20_000 });
      await expect(page.locator('body'), 'never the raw "asset not found" 404')
        .not.toHaveText(/^asset not found$/);
    });
});
