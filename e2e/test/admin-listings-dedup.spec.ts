// admin-listings-dedup.spec.ts —— the /admin/listings auto-fetch is once PER SESSION, so a full page
// reload in the same tab must NOT re-fetch — a fetch reaches out to every registered job board, and
// re-hammering them on every reload is the regression the sessionStorage dedup (a94b78720) guards.
//
// This is a request-COUNT assertion (a measured, falsifiable number — it rises if the dedup breaks),
// not an absence test. page.on('request') fires on dispatch, so a stray auto-fetch is counted the
// instant it is sent, before its response — no race with the reload.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'listings-dedup@example.com', password: 'correct-horse-battery-staple',
  handle: 'listingsdedup', fullName: 'Listings Dedup Owner',
};

const isAutoFetch = (method: string, url: string): boolean =>
  method === 'POST' && url.includes('/api/admin/listings/fetch');
const isListGet = (method: string, url: string): boolean =>
  method === 'GET' && url.includes('/api/admin/listings/');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin listings · auto-fetch once per session (a reload must not re-hammer the boards)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('first open auto-fetches exactly once; a reload in the same tab does not fetch again', async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    let posts = 0;
    page.on('request', (r) => { if (isAutoFetch(r.method(), r.url())) posts++; });

    // First open of the section → the auto-fetch fires exactly once.
    await page.getByTestId('admin-nav-listings').click();
    await expect(page.getByTestId('listings-fetch')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => posts, { message: 'auto-fetch fires once on first open', timeout: 20_000 }).toBe(1);

    // Reload the same tab. sessionStorage remembers this session already auto-fetched, so the mount
    // does its list GET but no second auto-fetch POST. Waiting for the GET (registered before the
    // reload) proves the mount effect ran — any stray POST would already have been counted.
    await Promise.all([
      page.waitForResponse((r) => isListGet(r.request().method(), r.url()), { timeout: 30_000 }),
      page.reload(),
    ]);
    await expect(page.getByTestId('listings-fetch'), 'section re-mounted after reload').toBeVisible({ timeout: 30_000 });
    expect(posts, 'a reload does not re-fetch — the dedup holds, count stays 1').toBe(1);
  });
});
