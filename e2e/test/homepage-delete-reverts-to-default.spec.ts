// homepage-delete-reverts-to-default.spec.ts —— the homepage is a reserved singleton served at `/`.
// "Deleting" it can't destroy the site root; it must **revert to the built-in default homepage**
// (DefaultHome), and it must ask first (a confirm modal, not the old immediate action that just
// echoed "delete failed" because the backend refuses a hard delete of `home`).
//
// Blackbox: publish a custom home carrying a distinctive marker, confirm `/` serves it, then drive
// the admin homepage card's delete → confirm modal → confirm, and assert `/` now renders the
// built-in DefaultHome (the marker is gone) while the home page row still exists (its draft is kept).
//
// RED on current code: clicking delete fires removePage('home') → backend ErrMicrositeHomeReserved
// → failure toast, no modal, and `/` still serves the custom home. GREEN once delete opens a modal
// and the confirmed home action unpublishes (clears live) so `/` falls through to DefaultHome.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'homedelete@example.com', password: 'correct-horse-battery-staple',
  handle: 'homedelete', fullName: 'Home Delete Owner',
};
const MARKER = 'CUSTOM_HOME_MARKER_x7q2';
const HOME_APP = `export default function App() {
  return <main data-testid="microsite"><h1>${MARKER}</h1></main>;
}
`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('homepage · delete reverts the site root to the built-in default', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a custom homepage can be reset to default via a confirm modal; / falls back to DefaultHome',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(300_000);

      // Arrange: publish a custom home carrying MARKER (create→write→build→live), confirm it serves.
      const seed = await playwright.request.newContext();
      const { csrf } = await loginAPI(seed, OWNER.email, OWNER.password);
      await publishPage(seed, csrf, 'home', HOME_APP, 300_000);
      await seed.dispose();
      expect(await (await page.request.get('/api/v1/homepage')).text(),
        'the custom home is live and carries the marker').toContain(MARKER);

      // Act 1: delete on the homepage card opens a confirm modal; Cancel does nothing.
      await gotoAdminSection(page, 'microsites');
      await page.waitForURL('**/admin/microsites', { timeout: 10_000 });
      await page.getByTestId('microsite-delete-home').click();
      const modal = page.getByRole('dialog');
      await expect(modal, 'delete asks first — a confirm modal').toBeVisible();
      await page.getByTestId('microsite-delete-cancel').click();
      await expect(modal, 'Cancel dismisses without acting').toBeHidden();

      // Act 2: confirm the reset.
      await page.getByTestId('microsite-delete-home').click();
      await page.getByTestId('microsite-delete-confirm').click();

      // Assert: the live custom home is gone (homepage endpoint 404s), and `/` now serves the
      // built-in DefaultHome (its server HTML carries the default-home marker, not the custom one).
      await expect
        .poll(async () => (await page.request.get('/api/v1/homepage')).status(),
          { message: '/ no longer serves a live custom home', timeout: 20_000 })
        .toBeGreaterThanOrEqual(400);
      const rootHtml = await (await page.request.get('/')).text();
      expect(rootHtml, '/ falls back to the built-in DefaultHome').toContain('data-testid="default-home"');
      expect(rootHtml, 'the custom home marker is gone').not.toContain(MARKER);

      await gotoAdminSection(page, 'microsites');
      await expect(page.getByTestId('microsite-homepage-card'), 'the home page row is kept (draft preserved)').toBeVisible();
      await expect(page.getByTestId('microsite-edit-homepage')).toBeVisible();
    });
});

