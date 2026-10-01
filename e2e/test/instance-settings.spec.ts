// instance-settings.spec.ts —— the instance's own settings are set on the system page, not in the
// deployment file.
//
// Owner, 2026-10-01, on the deployment template: "3应该留 … 12都给我弄没". Category 2 was the
// owner's settings living in env vars — the login check's Turnstile keys, the internal hosts the
// instance may reach, the skill catalogue it reads. Changing one meant editing a compose file and
// redeploying. Now each is a field on /admin/system, and each takes effect without a restart.
//
// Driven the way the owner does it: the system page, the settings panel, Save; then the thing the
// setting governs, used through its own surface.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'instsettings@example.com', password: 'correct-horse-battery-staple',
  handle: 'instsettings', fullName: 'Instance Settings Owner',
};

// Cloudflare's published always-pass test keys.
const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
// The in-stack stand-ins: an internal host, and the skill catalogue served from it.
const INTERNAL_HOST = 'external-mock';
const SPEC_URL = 'http://external-mock:9000/vendor-openapi/no-servers.json';
const CATALOGUE_URL = 'http://external-mock:9000/marketplace/github';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('instance settings live on the system page', () => {
  test.describe.configure({ mode: 'serial' });
  // bare: none of the stand-in settings the claim fixture normally applies — this spec sets them.
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, { ...OWNER, bare: true }); });

  test('an internal host the owner lists can be reached by a supplier', async ({ adminPage }) => {
    await fetchSpec(adminPage);
    await expect(adminPage.getByTestId('supplier-spec-error'), 'refused before it is listed')
      .toContainText(/internal|private|blocked|not allowed/i);
    await saveSettings(adminPage, { internalHosts: INTERNAL_HOST });
    await fetchSpec(adminPage);
    await expect(adminPage.getByTestId('supplier-spec-error'), 'now fetched: it asks for servers')
      .toContainText(/servers|base url/i);
  });

  test('the skill catalogue the owner names is the one the marketplace lists', async ({ adminPage }) => {
    await saveSettings(adminPage, { catalogue: CATALOGUE_URL });
    await gotoAdminSection(adminPage, 'skills');
    await adminPage.getByTestId('skills-tab-marketplace').click();
    await adminPage.getByTestId('marketplace-search').fill('tz-booking');
    await expect(adminPage.getByTestId('market-skill-tz-booking'), 'the stand-in catalogue’s skill')
      .toBeVisible({ timeout: 20_000 });
  });

  test('the owner turns the login check on, and the login page asks for it', async ({ adminPage }) => {
    await saveSettings(adminPage, { siteKey: TURNSTILE_SITE_KEY, secret: TURNSTILE_SECRET });
    const panel = adminPage.getByTestId('instance-settings');
    await expect(panel.getByTestId('instance-captcha-secret-stored'), 'the secret is kept, not shown')
      .toBeVisible();
    await openReader(adminPage, '/login');
    await expect(adminPage.getByTestId('turnstile-host'), 'the login page carries the check')
      .toBeVisible({ timeout: 15_000 });
  });
});

async function fetchSpec(page: Page): Promise<void> {
  await gotoAdminSection(page, 'suppliers');
  await page.getByTestId('supplier-add-open').click();
  await page.getByTestId('supplier-spec-url-input').fill(SPEC_URL);
  await page.getByTestId('supplier-spec-fetch-button').click();
}

async function saveSettings(
  page: Page, s: { internalHosts?: string; catalogue?: string; siteKey?: string; secret?: string },
): Promise<void> {
  // Straight to the page: a supplier modal left open by the step before covers the nav.
  await openReader(page, '/admin/system');
  const panel = page.getByTestId('instance-settings');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  if (s.internalHosts !== undefined) {
    await panel.getByTestId('instance-internal-hosts').fill(s.internalHosts);
  }
  if (s.catalogue !== undefined) await panel.getByTestId('instance-skill-catalogue').fill(s.catalogue);
  if (s.siteKey !== undefined) await panel.getByTestId('instance-captcha-site-key').fill(s.siteKey);
  if (s.secret !== undefined) await panel.getByTestId('instance-captcha-secret').fill(s.secret);
  await panel.getByTestId('instance-settings-save').click();
  await expect(panel.getByTestId('instance-settings-saved')).toBeVisible({ timeout: 15_000 });
}
