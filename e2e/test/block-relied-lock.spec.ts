// block-relied-lock.spec.ts — a block relied upon cannot be disabled (the relied-lock).
//
// The fiber view's rule: a block's Active toggle is locked while something relies on it —
// disabling it would break its dependents (everything-is-a-block.md, "relied upon → refuse
// 'X depends on it'"). GUI: install a provider (owner block, kind "block", provides a seam) and a
// consumer that requires it; open Plugins > blocks; the provider's enable toggle is disabled and
// its row shows the relied-lock reason naming the consumer.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'relied-lock@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'reliedlock',
  fullName: 'Relied Lock Owner',
};

function manifest(id: string, provides: string, requires?: string): string {
  const lines = [`id: ${id}`, `title: ${id}`, 'version: "1"', `provides: ${provides}`];
  if (requires) lines.push('requires:', `  - ${requires}`);
  return lines.join('\n');
}

async function install(request: APIRequestContext, csrf: string, m: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- fixture setup: install blocks
  const res = await request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: m },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('a relied-upon block cannot be disabled (relied-lock)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await install(request, csrf, manifest('rlprovider', 'rlseam'));
    await install(request, csrf, manifest('rlconsumer', 'rlapp', 'rlseam'));
    await request.dispose();
  });

  test('the provider block toggle is locked, with the reason naming the consumer',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'blocks');
      await adminPage.waitForURL('**/admin/blocks', { timeout: 5_000 });

      const row = adminPage.getByTestId('block-row-rlprovider');
      await expect(row).toBeVisible({ timeout: 10_000 });

      // The relied-lock reason shows and names the consumer.
      const lock = adminPage.getByTestId('block-relied-lock-rlprovider');
      await expect(lock).toBeVisible({ timeout: 10_000 });
      await expect(lock).toContainText('rlconsumer');

      // The provider's enable toggle is disabled — it cannot be switched off while relied upon.
      await expect(row.getByTestId('block-enabled-toggle')).toBeDisabled();

      // Delete is locked too: dropping a relied-upon block is irreversible (its schema goes), so
      // the control is disabled rather than offering a delete the backend would refuse (item 32).
      await expect(row.getByTestId('delete-rlprovider')).toBeDisabled();

      await adminPage.screenshot({ path: 'test-results/relied-lock.png', fullPage: true });
    });
});
