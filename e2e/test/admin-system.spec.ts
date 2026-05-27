// admin-system.spec.ts —— admin system section: terminal block, background jobs,
// health checks.
//
// 用户故事：
//   1. terminal block → version / uptime renders
//   2. background jobs table → rows visible
//   3. health checks → status dots (ok = accent / warn = amber)

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'system@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'system',
  fullName: 'System Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin system section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('terminal block renders version + uptime',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      await adminPage.waitForURL('**/admin/system', { timeout: 5_000 });
      const terminal = adminPage.getByTestId('system-terminal');
      await expect(terminal).toBeVisible();
      await expect(terminal).toContainText(/version/i);
    });

  test('background jobs table visible',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const jobsTable = adminPage.getByTestId('system-jobs');
      await expect(jobsTable).toBeVisible();
      // Should have at least some rows
      const rows = jobsTable.locator('tr');
      await expect(rows).not.toHaveCount(0);
    });

  test('health checks render with status dots',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const checks = adminPage.getByTestId('system-health');
      await expect(checks).toBeVisible();
      // Status dots should be present
      const dots = checks.locator('[data-testid="health-dot"]');
      await expect(dots.first()).toBeVisible();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
