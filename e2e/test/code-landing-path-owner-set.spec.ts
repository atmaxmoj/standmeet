// code-landing-path-owner-set.spec.ts —— the owner names a code's landing path (/c/<slug>) in the
// admin, at creation and later. Ledger 2026-09-08 (e2e gap audit): the backend always generated the
// slug — the create op never passed one through and nothing could change it, so a code printed on a
// résumé carried a path like /c/7ksd92mf. The owner's words for it are the path's whole point: a
// readable, stable address. Owner 2026-10-01: "后台自定义访问码 slug … 做一下".

import { test, expect } from '@/fixtures/test';
import type { Browser, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'landing-path@example.com', password: 'correct-horse-battery-staple',
  handle: 'landingpath', fullName: 'Landing Path Owner',
};
const CODE = 'ACME-RECRUIT';
const TAKEN = 'TAKEN-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.serial('access codes · the owner names the landing path', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('a code created with a path lands the visitor on /c/<that path>', async ({ adminPage, browser }) => {
    await gotoAdminSection(adminPage, 'codes');
    await adminPage.getByRole('button', { name: /new code/i }).click();
    await adminPage.getByTestId('code-input').fill(CODE);
    await adminPage.getByTestId('code-label').fill('Acme recruiter');
    await adminPage.getByTestId('code-slug').fill('acme-recruiter');
    await adminPage.getByTestId('code-create').click();
    await expect(adminPage.getByTestId(`code-landing-${CODE}`), 'the card shows the path')
      .toHaveText('/c/acme-recruiter', { timeout: 10_000 });

    await expectVisitorLandsOn(browser, '/c/acme-recruiter');
  });

  test('the owner changes the path later; the next visitor lands on the new one', async ({ adminPage, browser }) => {
    await gotoAdminSection(adminPage, 'codes');
    await openEdit(adminPage);
    await adminPage.getByTestId('code-slug').fill('acme-2026');
    await adminPage.getByTestId('code-save').click();
    await expect(adminPage.getByTestId(`code-landing-${CODE}`), 'the card shows the new path')
      .toHaveText('/c/acme-2026', { timeout: 10_000 });

    await expectVisitorLandsOn(browser, '/c/acme-2026');
  });

  test('a path another code already uses is refused with a sentence, and nothing changes', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'codes');
    await openEdit(adminPage);
    await adminPage.getByTestId('code-slug').fill('already-used');
    await adminPage.getByTestId('code-save').click();
    await expect(adminPage.getByText(/already used by another code/i), 'says why').toBeVisible({ timeout: 10_000 });
    await adminPage.keyboard.press('Escape');
    await expect(adminPage.getByTestId(`code-landing-${CODE}`), 'the path stayed').toHaveText('/c/acme-2026');
  });
});

// openEdit —— the card's own "edit" button (the card has other buttons whose names contain "edit").
async function openEdit(page: Page): Promise<void> {
  await page.getByTestId(`code-card-${CODE}`).getByRole('button', { name: 'edit', exact: true }).click();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: TAKEN, label: 'taken', slug: 'already-used' });
  await request.dispose();
}

async function expectVisitorLandsOn(browser: Browser, path: string): Promise<void> {
  const ctx = await browser.newContext();
  const page: Page = await ctx.newPage();
  await enterCodeSession(page, CODE, 'Recruiter');
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
  await ctx.close();
}
