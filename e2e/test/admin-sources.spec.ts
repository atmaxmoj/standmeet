// admin-sources.spec.ts —— admin /sources lists the owner's real job sources
// (#51). Sources are registered via MCP jobs.register_source; the admin section
// is read-only and now fetches GET /api/admin/job-sources/ (was a stub).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'sources@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sources',
  fullName: 'Sources Owner',
};
const LABEL = 'Sources Test Board';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sources list', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('empty state when no source is registered',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByText(/no sources registered/i)).toBeVisible();
    });

  test('no dead "+board"/"+rss" add buttons — sources are MCP-registered (F-E-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      // The old header buttons opened no form and contradicted the page's own copy. Removed —
      // the page directs to the jobs.register_source MCP tool instead.
      await expect(adminPage.getByRole('button', { name: /\+\s*board/i })).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: /rss|scraper/i })).toHaveCount(0);
      await expect(adminPage.getByText(/jobs\.register_source/i).first()).toBeVisible();
    });

  test('a registered source appears in the list',
    async ({ request, adminPage }) => {
      await seedSource(request);
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByTestId('sources-list')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(LABEL)).toBeVisible();
    });
});

async function seedSource(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'sources-seed');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: LABEL, config: { company: 'airbnb' },
  });
}
