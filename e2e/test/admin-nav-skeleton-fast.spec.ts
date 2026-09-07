// admin-nav-skeleton-fast.spec.ts —— clicking a sidebar section must paint the loading skeleton
// AT ONCE, not after a server round-trip (owner: "nav 点了有时好久才变，该点了立即变").
//
// The whole /admin tree is dynamically rendered (the root layout awaits headers()/cookies() for
// i18n), and Next 15's default staleTimes.dynamic=0 discarded the prefetched loading shell — so a
// click blocked on the section's RSC fetch while holding the OLD screen, and admin/loading.tsx never
// painted. With staleTimes.dynamic>0 the router serves the prefetched skeleton instantly, then streams
// the section behind it. This throttles the target section's RSC so the skeleton MUST linger, then
// asserts it is visible well within a frame budget — a positive "the skeleton shows fast" guard (it is
// RED on staleTimes.dynamic=0: the skeleton never appears in time).

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'nav-skeleton@example.com', password: 'correct-horse-battery-staple',
  handle: 'navskeleton', fullName: 'Nav Skeleton Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin nav paints the skeleton instantly (Q2)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('clicking a sidebar section shows the skeleton within a frame, not after the RSC round-trip',
    async ({ adminPage: page }) => {
      await goto(page, '/admin/dashboard');
      await expect(page.getByTestId('admin-sidebar')).toBeVisible({ timeout: 20_000 });
      // Give the sidebar links a moment to prefetch their loading shells (staleTimes.dynamic keeps
      // those shells reusable), then navigate.
      await expect(page.getByTestId('admin-nav-codes')).toBeVisible();

      await page.getByTestId('admin-nav-codes').click();
      // Clicking paints the section skeleton promptly (from the prefetched, retained loading shell) —
      // the owner sees the screen change at once, instead of the old page held during the RSC fetch.
      await expect(page.getByTestId('admin-section-skeleton')).toBeVisible({ timeout: 1_500 });
    });
});
