// byoai-save-clean.spec.ts —— saving BYOAI must not dump a raw ZodError into the panel.
//
// The bug: use-byoai validated the PUT /byoai response against MeViewSchema ({owner,settings}),
// but that endpoint returns the settings slice ({ai,byoai,monitoring_enabled}) by design. The
// mismatch threw a ZodError whose message ("invalid_type", path ["owner"]/["settings"]) was
// rendered verbatim next to the save button. RED on the old code (hint shows invalid_type);
// green once the response is validated against SettingsViewSchema.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'byoai-save@example.com', password: 'correct-horse-battery-staple',
  handle: 'byoaisave', fullName: 'BYOAI Save Owner',
};
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin · BYOAI save is clean prose, no raw ZodError', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('enabling a provider and saving shows no invalid_type error and persists', async ({ adminPage }) => {
    test.setTimeout(90_000);
    await gotoAdminSection(adminPage, 'account');
    await expect(adminPage.getByTestId('byoai-editor')).toBeVisible({ timeout: 20_000 });

    // Ensure BYOAI is on (the provider chips only render when enabled), so save has real content.
    const providers = adminPage.getByTestId('byoai-providers');
    if (!(await providers.isVisible())) {
      await adminPage.getByTestId('byoai-toggle').click();
      await expect(providers).toBeVisible();
    }

    await adminPage.getByTestId('byoai-save').click();

    // The hint next to the button must never carry the raw validation error.
    const hint = adminPage.getByTestId('byoai-hint');
    await expect(hint, 'save hint must not leak a raw ZodError').not.toContainText('invalid_type', { timeout: 15_000 });
    const body = (await adminPage.locator('body').innerText());
    expect(body, 'no raw zod issue json anywhere on the panel').not.toContain('invalid_type');
    expect(body, 'no zod path leak').not.toContain('"path"');

    // The save really persisted: reload the section and BYOAI is still enabled.
    await gotoAdminSection(adminPage, 'account');
    await expect(adminPage.getByTestId('byoai-providers'), 'enabled state persisted').toBeVisible({ timeout: 20_000 });
  });
});
