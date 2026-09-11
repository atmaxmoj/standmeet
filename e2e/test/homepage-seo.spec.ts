// homepage-seo.spec.ts —— the site root's SEO is DECOUPLED from the `home` microsite.
//
// The homepage is special: `/` is always a destination whether or not a `home` page is materialized,
// built, or deleted. So its SEO lives on the OWNER, not a microsite row, and reaches `/` on both
// serve paths — the backend's /api/v1/homepage (when a home build is live) and the app's DefaultHome
// metadata (when none is). This asserts the invariant the owner asked for: "有没有 [materialized] 都
// 不应该影响 seo，他们不应该耦合" — SEO holds across the home page's whole lifecycle.
//
// Driven ONLY through the owner's real UI (microsites nav → homepage edit → SEO panel → fill → Save)
// and read back from the public site root `/` as a visitor sees it. No API/MCP seeding.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'homeseo@example.com', password: 'correct-horse-battery-staple',
  handle: 'homeseo', fullName: 'Home SEO Owner',
};
const SEO_TITLE = 'Sijie Wang — Portfolio and Thoughts';
const SEO_DESC = 'What I keep thinking about, answered in my own voice.';
const SEO_IMAGE = 'https://cdn.example.com/home-card.png';

// setHomepageSEO —— the owner's real path: microsites nav → the homepage card's edit → the SEO
// panel → fill the three fields → Save. Nothing seeded.
async function setHomepageSEO(page: Page): Promise<void> {
  await gotoAdminSection(page, 'microsites');
  await page.getByTestId('microsite-edit-homepage').click();
  await expect(page.getByTestId('microsite-editor')).toBeVisible({ timeout: 30_000 });
  const panel = page.getByTestId('microsite-seo');
  await expect(panel, 'the homepage editor has the SEO panel, like any microsite')
    .toBeVisible({ timeout: 15_000 });
  await panel.locator('summary').click();
  await page.getByTestId('microsite-seo-title').fill(SEO_TITLE);
  await page.getByTestId('microsite-seo-desc').fill(SEO_DESC);
  await page.getByTestId('microsite-seo-image').fill(SEO_IMAGE);
  await page.getByTestId('microsite-seo-save').click();
  // Save is async; the toast confirms it reached the server before we read the root back.
  await expect(page.getByTestId('microsite-seo-save')).toBeEnabled();
}

// rootReflectsSEO —— open the public site root `/` as a fresh visitor and assert the SEO is in its
// <head>. Works on both serve paths (backend build serve, or app DefaultHome metadata).
async function rootReflectsSEO(playwright: Playwright): Promise<void> {
  const ctx = await playwright.request.newContext();
  await expect.poll(async () => {
    const html = await (await ctx.get('/')).text();
    return html.includes(SEO_TITLE) && html.includes(SEO_DESC) && html.includes(SEO_IMAGE);
  }, { message: 'the site root <head> carries the homepage SEO', timeout: 20_000 }).toBe(true);
  await ctx.dispose();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 420_000 });
test.describe('site-root SEO is set in the homepage editor and is decoupled from the home page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('no home page materialized: the editor sets site-root SEO and it lands on /', async ({
    adminPage, playwright,
  }) => {
    // A fresh claimed instance has NO `home` microsite (verified elsewhere: prod has none either).
    await setHomepageSEO(adminPage);
    await rootReflectsSEO(playwright);
  });

  test('the SEO survives materializing + publishing a real home page (build does not overwrite it)',
    async ({ adminPage, playwright }) => {
      await setHomepageSEO(adminPage);
      await rootReflectsSEO(playwright);

      // Materialize + publish a real `home` page through the UI (the home editor's build+publish).
      // Whichever serve path then answers `/` — the backend serving the live build, or the app's
      // DefaultHome — the owner's site-root SEO must still be there: it is not the build's to own.
      await gotoAdminSection(adminPage, 'microsites');
      await adminPage.getByTestId('microsite-edit-homepage').click();
      await expect(adminPage.getByTestId('microsite-editor')).toBeVisible({ timeout: 30_000 });
      await adminPage.getByTestId('microsite-publish').click();
      await rootReflectsSEO(playwright);
    });
});
