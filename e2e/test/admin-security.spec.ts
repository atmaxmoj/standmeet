// admin-security.spec.ts —— UI-driven proof for the Security / IP-bans section
// (#58-5). Owner bans an IP in the admin UI → it lands in the list → unban
// removes it. Enforcement (public 403) is covered at the API level in
// admin-ip-bans.spec.ts; here we prove the section wires to the real backend.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'security@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'security',
  fullName: 'Security Owner',
};
const IP = '203.0.113.42';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin /ip-bans section', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('empty state → ban an IP → it appears → unban → gone',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'ip-bans');
      await adminPage.waitForURL('**/admin/ip-bans');
      await expect(adminPage.getByTestId('ban-form')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(/no ips banned/i)).toBeVisible();

      await adminPage.getByTestId('ban-ip').fill(IP);
      await adminPage.getByTestId('ban-reason').fill('e2e abuse');
      await adminPage.getByTestId('ban-submit').click();

      const row = adminPage.getByTestId(`ban-row-${IP}`);
      await expect(row).toBeVisible({ timeout: 5_000 });
      await expect(row).toContainText(IP);

      await adminPage.getByTestId(`unban-${IP}`).click();
      await expect(adminPage.getByTestId(`ban-row-${IP}`)).toHaveCount(0);
    });
});
