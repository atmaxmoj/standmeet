// admin-nav-skeleton.spec.ts —— Q2: clicking a sidebar section navigates INSTANTLY and shows a
// skeleton, instead of Next holding the old screen until the section's RSC + data arrive. The shared
// admin/loading.tsx is the Suspense fallback for every section (they render in admin/layout's
// {children}).
//
// Deterministic (no timing luck): we DELAY the section's admin API so the loading fallback is
// guaranteed observable, then assert the skeleton appears. RED without admin/loading.tsx (the old
// screen would linger and no skeleton testid would exist).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'navskel@example.com', password: 'correct-horse-battery-staple',
  handle: 'navskel', fullName: 'Nav Skel Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin section nav shows an instant skeleton (Q2)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('clicking a section flips the URL at once and shows the section skeleton', async ({ adminPage: page }) => {
    test.setTimeout(60_000);
    // Start on a KNOWN section (dashboard) so the click below is a real cross-section navigation.
    await page.locator('a[href="/admin/dashboard"]').first().click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 20_000 });

    // HOLD the section's data until we've asserted the skeleton — deterministic, no sleep. The route
    // handler blocks on this promise, so the fallback is guaranteed visible until we release it.
    let releaseData: () => void = () => undefined;
    const dataHeld = new Promise<void>((resolve) => { releaseData = resolve; });
    await page.route('**/api/admin/**', async (route) => {
      await dataHeld;
      await route.continue();
    });

    // Click another section (href-based, matches AdminSidebar's <Link href="/admin/<slug>">).
    await page.locator('a[href="/admin/wiki"]').first().click();

    // The URL flips immediately (navigation committed, not blocked on the RSC)…
    await expect(page).toHaveURL(/\/admin\/wiki$/, { timeout: 5_000 });
    // …and the shared section skeleton is shown while the held data waits.
    await expect(page.getByTestId('admin-section-skeleton'),
      'the section skeleton must appear during load, not the old screen').toBeVisible({ timeout: 5_000 });

    releaseData(); // let the section's data through now
    // unrouteAll, not unroute: releaseData() only RESUMES the held handlers (on a microtask),
    // so they are still mid-`route.continue()` while the test walks on. Plain `page.unroute`
    // tears the pattern down without waiting for them, Playwright continues those routes
    // itself, and the handler's own `continue()` then throws "Route is already handled!" —
    // from line 38, as if the product had done something. Which side of that race wins is
    // machine load: this spec passed alone and failed inside the full suite. The teardown of a
    // test DEVICE must not be able to fail the test; every product assertion above is
    // untouched.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
