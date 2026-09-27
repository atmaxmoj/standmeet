// codes-filter.spec.ts —— the access-codes admin list stays usable as codes pile up: a status filter
// (active / revoked / expired / all, default active, each with its count) and a search by code or
// label.
//
// Before: one grid mixed every code — on sijie.xyz 4 active codes sat among 8 revoked self-test and
// block-test codes. "Expired" is not stored: it is an active code whose expires_at has passed, derived
// from that one field.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codesfilter@example.com', password: 'correct-horse-battery-staple',
  handle: 'codesfilter', fullName: 'Codes Filter Owner',
};

async function listed(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="code-row-"]');
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  return ids.map((id) => id.replace('code-row-', '')).sort();
}

async function expectListed(page: Page, codes: string[]): Promise<void> {
  await expect.poll(() => listed(page), { timeout: 10_000 }).toEqual([...codes].sort());
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · access codes filter and search', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: 'ACTIVE-ALPHA', label: 'alpha recruiter' });
    await createCode(request, csrf, { code: 'ACTIVE-BETA', label: 'beta conference' });
    const gone = await createCode(request, csrf, { code: 'REVOKED-GAMMA', label: 'gamma test' });
    await revokeCode(request, csrf, gone.id);
    await createCode(request, csrf, { code: 'EXPIRED-DELTA', label: 'delta old' });
    execSQL(`UPDATE access_codes SET expires_at = now() - interval '1 day' WHERE code = 'EXPIRED-DELTA'`);
    await request.dispose();
  });

  test('the list opens on active codes; each filter shows its own, with counts', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'codes');
    await expectListed(page, ['ACTIVE-ALPHA', 'ACTIVE-BETA']);
    await expect(page.getByTestId('codes-filter-active')).toContainText('2');
    await expect(page.getByTestId('codes-filter-revoked')).toContainText('1');
    await expect(page.getByTestId('codes-filter-expired')).toContainText('1');
    await expect(page.getByTestId('codes-filter-all')).toContainText('4');

    await page.getByTestId('codes-filter-revoked').click();
    await expectListed(page, ['REVOKED-GAMMA']);
    await page.getByTestId('codes-filter-expired').click();
    await expectListed(page, ['EXPIRED-DELTA']);
    await page.getByTestId('codes-filter-all').click();
    await expectListed(page, ['ACTIVE-ALPHA', 'ACTIVE-BETA', 'EXPIRED-DELTA', 'REVOKED-GAMMA']);
  });

  test('search narrows by label or code within the chosen filter', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'codes');
    await page.getByTestId('codes-search').fill('beta');
    await expectListed(page, ['ACTIVE-BETA']);
    await page.getByTestId('codes-search').fill('delta');
    await page.getByTestId('codes-filter-all').click();
    await expectListed(page, ['EXPIRED-DELTA']);
    await page.getByTestId('codes-search').fill('ALPHA');
    await expectListed(page, ['ACTIVE-ALPHA']);
  });
});
