// microsite-publish-one-build.spec.ts —— Publish takes over the edit it follows: one build, one
// status line.
//
// Before: every edit schedules an auto-build 800ms later. An owner who types and clicks Publish
// inside that window got two builds — Publish's own, and the auto-build firing after it. Both
// wrote the one status line, so the page went live ("Page published") while the line flipped back
// to "building…" until the second build settled. The owner reads "it's still building"; the
// microsite.spec take-down case read it as a missing toast (red 2026-09-20, 09-27).

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'onebuild@example.com', password: 'correct-horse-battery-staple',
  handle: 'onebuild', fullName: 'One Build Owner',
};
const SLUG = 'one-build';

test.describe.configure({ timeout: 300_000 });
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite editor · publish right after typing', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('starts one build, and the status stays "built" once the page is published',
    async ({ adminPage: page }) => {
      const builds: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith(`/microsites/${SLUG}/build`)) builds.push(r.url());
      });
      await openReader(page, '/admin/edit/new');
      await page.getByTestId('microsite-slug').fill(SLUG);
      const body = page.getByTestId('microsite-source').locator('.cm-content');
      await body.click();
      await body.fill('export default function App() {\n  return <h1>ONE_BUILD</h1>;\n}');
      // Inside the auto-build's 800ms debounce: this is the owner who types and publishes.
      await page.getByTestId('microsite-publish').click();

      await expect(page.getByTestId('toast-success').filter({ hasText: 'Page published' }))
        .toBeVisible({ timeout: 240_000 });
      // A build takes tens of seconds; the debounce is 800ms. A second build would have been
      // requested long before the publish finished.
      expect(builds, 'publish and the pending auto-build are one build').toHaveLength(1);
      await expect(page.getByTestId('microsite-build-status')).toHaveText(/built/i);
    });
});
