// gas-admin-ui.spec.ts —— the owner's half of the paddle.
//
// The gas rules are proven over the API in gas-quota.spec.ts, and that spec would stay green with
// no gauge on the screen at all: an owner who cannot see how much fuel is left, cannot fill a tank,
// and cannot turn a role's gauge on has no feature. Both switches live on different pages — the
// fuel on the provider book, the gauge on the role card — so this walks both.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'gasui@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gasui',
  fullName: 'Gas UI Owner',
};

// CLAIM_LABEL —— what first-run claim names the entry it creates (repo/provider_view.go).
const CLAIM_LABEL = 'default';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('gas · the owner can read the gauge and fill the tank', () => {
  test('a tank with no fuel in it reads as unmetered, not as empty', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'api-mcp');
    // "0" would say the opposite of what is true: nothing is metered here, and an owner who reads
    // an empty gauge believes their visitors are already blocked.
    await expect(adminPage.getByTestId(`provider-gas-${CLAIM_LABEL}`))
      .toHaveText('unmetered', { timeout: 5_000 });
  });

  test('filling it puts a reading on the gauge', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'api-mcp');
    await adminPage.getByTestId(`provider-gas-input-${CLAIM_LABEL}`).fill('250000');
    await adminPage.getByTestId(`provider-gas-fill-${CLAIM_LABEL}`).click();

    // Full, and shown at a readable magnitude — the last digits change every answer.
    await expect(adminPage.getByTestId(`provider-gas-${CLAIM_LABEL}`))
      .toHaveText('250.0k / 250.0k', { timeout: 5_000 });
  });

  test('the reading survives a reload — it is stored, not local state',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      await adminPage.reload();
      await expect(adminPage.getByTestId(`provider-gas-${CLAIM_LABEL}`))
        .toHaveText('250.0k / 250.0k', { timeout: 8_000 });
    });

  test('removing the gauge puts it back to unmetered', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'api-mcp');
    await adminPage.getByTestId(`provider-gas-unmeter-${CLAIM_LABEL}`).click();
    await expect(adminPage.getByTestId(`provider-gas-${CLAIM_LABEL}`))
      .toHaveText('unmetered', { timeout: 5_000 });
  });
});

test.describe('gas · the role card carries the gauge switch', () => {
  test('turning it on for a role persists', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'roles');
    const toggle = adminPage.getByTestId('role-gas-metered-public');
    await expect(toggle, 'off by default — that is today’s path').not.toBeChecked();

    // click, not check(): the box is driven by the stored value, so it only flips once the write
    // comes back. check() asserts an instant flip and would fail on a switch that works.
    await toggle.click();
    await expect(adminPage.getByTestId('toast-success')).toBeVisible({ timeout: 5_000 });
    await expect(toggle, 'the store took the new value').toBeChecked({ timeout: 5_000 });

    await adminPage.reload();
    await expect(
      adminPage.getByTestId('role-gas-metered-public'),
      'a switch that forgets is a switch that lies',
    ).toBeChecked({ timeout: 8_000 });
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
