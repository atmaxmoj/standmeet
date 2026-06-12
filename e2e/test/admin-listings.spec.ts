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
