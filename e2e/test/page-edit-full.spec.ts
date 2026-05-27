// page-edit-full.spec.ts —— PageSection 除 hero_prose 之外的字段也走通：
// where.location_line + contact.email 改了 → save → 公开页同步显示。
//
// page-edit.spec.ts 只测 hero_prose 一字段；其他 6 个 section 都没测过，
// 这条补足"改了就生效"的整体保证。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_LOCATION = 'Vancouver · UTC−8';
const NEW_EMAIL = 'reach@alice.example';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('PageSection — non-hero fields round-trip', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('owner edits where.location_line + contact.email → public page reflects both',
    async ({ adminPage: page }) => {
      await fillEditField(page, 'where-location', NEW_LOCATION);
      await fillEditField(page, 'contact-email', NEW_EMAIL);
      await save(page);
      await visitPublicPage(page);
      await expect(page.getByText(NEW_LOCATION)).toBeVisible();
      await expect(page.getByText(NEW_EMAIL)).toBeVisible();
    });
});

async function fillEditField(page: Page, testid: string, value: string): Promise<void> {
  const field = page.getByTestId(testid);
  await expect(field).toBeVisible({ timeout: 5_000 });
  await field.fill(value);
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 5_000 });
}

async function visitPublicPage(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'view public ↗' }).click();
  await page.waitForURL('**/', { timeout: 10_000 });
}
