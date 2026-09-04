// admin-listings.spec.ts —— admin /listings lists the owner's real job pool
// (#50). Jobs land in a Redis 1d-TTL pool via MCP jobs.fetch_new; the admin
// section is read-only and now fetches GET /api/admin/listings/ (was a stub).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsRegisterSource, jobsFetchNew } from '@/fixtures/jobs';

const OWNER = {
  email: 'listings@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'listings',
  fullName: 'Listings Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin listings list', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('empty state when the pool has no jobs',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'listings');
      await adminPage.waitForURL('**/admin/listings', { timeout: 5_000 });
      await expect(adminPage.getByText(/no listings in pool/i)).toBeVisible();
    });

  test('fetched jobs appear in the list',
    async ({ request, adminPage }) => {
      const firstTitle = await seedPool(request);
      await gotoAdminSection(adminPage, 'listings');
      await adminPage.waitForURL('**/admin/listings', { timeout: 5_000 });
      await expect(adminPage.getByTestId('listings-list')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(firstTitle)).toBeVisible();
    });

  // Sibling of F-N-3 (admin-shell check 2: every badge must equal the table it summarizes).
  // The sidebar reserved a badge slot for listings —— `NAV_GROUPS` has `badgeTestId: 'badge-listings'`,
  // `SidebarBadges` has `listings`, and `BADGE_MAP` maps it too —— **three declarations, zero writers**.
  // So while 1148 real jobs sit in the pool, the sidebar says nothing; and the owner sees this cell on every page.
  //
  // The criterion must **first prove the pool is non-empty** before asserting the badge: otherwise, when the pool
  // is empty, "no badge" is also correct, and this assertion stays forever green ([[assertion-that-cannot-fail]]).
  test('the sidebar badge counts the pool it summarizes',
    async ({ request, adminPage }) => {
      await seedPool(request);
      await gotoAdminSection(adminPage, 'listings');
      await adminPage.waitForURL('**/admin/listings', { timeout: 5_000 });

      // The header's "· N in pool" is this section's own reported count; take it as the ground truth.
      const header = adminPage.getByTestId('section-header');
      await expect(header).toContainText(/\d+ in pool/, { timeout: 10_000 });
      const inPool = Number(/(\d+) in pool/.exec(await header.innerText())?.[1] ?? '0');
      expect(inPool, '池子必须先真有东西，否则下面那条断言不会红').toBeGreaterThan(0);

      const badge = adminPage.getByTestId('badge-listings');
      await expect(
        badge,
        `the pool holds ${inPool} jobs and the sidebar says nothing`,
      ).toBeVisible({ timeout: 10_000 });
      expect(Number((await badge.innerText()).trim()), 'badge 必须等于它汇总的那张表')
        .toBe(inPool);
    });
});

async function seedPool(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'listings-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Listings Board', config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs');
  return jobs[0]!.title;
}
