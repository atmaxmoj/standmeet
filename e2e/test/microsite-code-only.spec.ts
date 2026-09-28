// microsite-code-only.spec.ts — "open without an access code" means what it says.
//
// Owner report (2026-09-28): the pages table showed, per page, the line "no code opens this —
// anonymous only" over a switch, and for the cover-letter page "opened by MATTERMOST-SFS". The
// owner read the switch as "may this page be opened without a code" and expected the bound
// cover letter to be closed to anyone without the code. In fact no page checked anything: the
// line was a status, the unlabelled switch was bring-your-own-key, and /p/<slug> served every page
// to everyone.
//
// Owner decision: the switch is "open without an access code". ON → anyone can open the page.
// OFF → only a visitor holding a code can; one without is sent to enter a code. A page with a
// code bound starts OFF. The bound codes get their own column.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createMicrosite } from '@/fixtures/admin-mutations';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import { enterCodeSession, gotoAdminSection, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'code-only@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codeonly',
  fullName: 'Code Only Owner',
};
const SLUG = 'cover-letter';
const CODE = 'COVER-001';
const MARK = 'A letter for one reader';
const APP = `export default function App() {
  return <main data-testid="microsite"><h1>${MARK}</h1></main>;
}`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.serial('microsites · open without an access code', () => {
  let admin: APIRequestContext;
  let csrfToken = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000); // one microsite build
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    ({ csrf: csrfToken } = await loginAPI(admin, OWNER.email, OWNER.password));
    await publishPage(admin, csrfToken, SLUG, APP, 400_000);
    const code = await createCode(admin, csrfToken, { code: CODE, label: 'cover' });
    await bindCodeToPage(admin, csrfToken, code.id, SLUG);
  });

  test.afterAll(async () => { await admin.dispose(); });

  test('the owner sees the bound code in its own column and the switch off', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'microsites');
    await expect(adminPage.getByTestId(`microsite-codes-${SLUG}`), 'the codes column').toContainText(CODE);
    const open = adminPage.getByTestId(`microsite-without-code-${SLUG}`);
    await expect(open, 'the switch says what it does').toHaveAccessibleName(/without an access code/i);
    await expect(open, 'a page with a code bound starts closed').toHaveAttribute('aria-checked', 'false');
  });

  test('without a code, the closed page sends the visitor to enter one', async ({ browser }) => {
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await openReader(page, `/p/${SLUG}`);
    await page.waitForURL('**/gate**', { timeout: 15_000 });
    await expect(page.getByTestId('gate-code'), 'the code entry is offered').toBeVisible();
    await visitor.close();
  });

  test('with the code, the visitor reads the page', async ({ browser }) => {
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await enterCodeSession(page, CODE, 'Recruiter');
    await page.waitForURL(`**/p/${SLUG}**`, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: MARK })).toBeVisible({ timeout: 15_000 });
    await visitor.close();
  });

  // Found on prod 2026-09-28: every promote receipt said open_without_code:false and
  // bound_codes:[] — even for public pages, and for a page with a code bound. A single-page
  // receipt never loaded either field and printed their zero values. A receipt that does not know
  // a field leaves it out; one that states it states the truth.
  test('a page receipt never misstates who opens the page', async () => {
    const made = await createMicrosite(admin, csrfToken, { slug: 'receipt-check', title: 'r' });
    expect(made['open_without_code'] ?? true, 'a new page with no code opens without one')
      .toBe(true);
  });

  test('switched on, anyone reads the page', async ({ adminPage, browser }) => {
    await gotoAdminSection(adminPage, 'microsites');
    const open = adminPage.getByTestId(`microsite-without-code-${SLUG}`);
    await open.click();
    await expect(open, 'the switch is on').toHaveAttribute('aria-checked', 'true');

    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await openReader(page, `/p/${SLUG}`);
    await expect(page.getByRole('heading', { name: MARK }), 'served without a code')
      .toBeVisible({ timeout: 15_000 });
    await visitor.close();
  });
});
