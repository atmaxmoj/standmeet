// microsite-preview-state-label.spec.ts —— #3: the editor's preview-pane caption reflects whether
// the previewed build is LIVE or STAGING, computed from latest_build_id vs live_build_id. It used to
// be a hardcoded "preview (staging) — not yet live", which lied whenever the build being previewed
// was already the live one.
//
// Positive + falsifiable: publish a page (build + promote to live) so the previewed build IS the live
// build → open its editor → the caption reads the LIVE label, not the old staging text.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'preview-state@example.com', password: 'correct-horse-battery-staple',
  handle: 'previewstate', fullName: 'Preview State Owner',
};
const SLUG = 'presskit';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite editor · the preview caption is live vs staging (computed, not hardcoded)', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(240_000);
    await claimFreshOwner(playwright, OWNER);
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPage(request, csrf, SLUG); // create → write → build → promote to live
    await request.dispose();
  });

  test('previewing the live build reads "live", not the old "not yet live"', async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    // Reach the editor by clicking (microsites nav → the page's own row), not a goto teleport.
    await page.getByTestId('admin-nav-microsites').click();
    await page.getByTestId(`microsite-open-${SLUG}`).click({ timeout: 30_000 });

    // The preview pane's caption is the computed state — the live label, because the previewed build
    // is the live build (latest_build_id === live_build_id after promote).
    await expect(page.getByTestId('microsite-preview-state'), 'live build previewed → "live" caption')
      .toHaveText('live', { timeout: 60_000 });
  });
});
