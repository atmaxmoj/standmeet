// conversations-per-code.spec.ts —— the owner clicks "view conversations" on an admin code
// card → lands on /admin/conversations?code=... → sees only sessions under that code.
//
// User story:
//   The owner issued two codes, one for a recruiter and one for an investor. To see the
//   conversation under the recruiter's code, they just jump there directly from the card,
//   instead of eyeballing it out of the full list.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const HR_CODE = 'HR-001';
const INV_CODE = 'INV-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin filters conversations by code via UI link', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedCodesAndChats(request);
    await request.dispose();
  });

  test('view conversations link from HR code shows only that code\'s session',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'codes');
      await page.waitForURL('**/admin/codes', { timeout: 5_000 });
      // Each of the two code cards has its own "view conversations" link; pick the one on the HR card.
      await page.getByTestId(`code-card-${HR_CODE}`)
        .getByRole('link', { name: 'view conversations →' }).click();
      await page.waitForURL(`**/admin/conversations?code=${HR_CODE}`, { timeout: 5_000 });

      await expect(page.getByTestId('conv-filter-chip')).toContainText(HR_CODE);
      // The visitor named "Recruiter" went through the HR code → a row should appear; the
      // Investor row should not. Use an exact match against the rendered visitor name to
      // avoid a name collision with a label like "Investor intro".
      await expect(page.getByText('Recruiter', { exact: true })).toBeVisible();
      await expect(page.getByText('Investor', { exact: true })).toHaveCount(0);

      // Click "clear ×" → back to the list with no code filter; both rows are visible.
      await page.getByRole('link', { name: 'clear ×' }).click();
      await page.waitForURL('**/admin/conversations', { timeout: 5_000 });
      await expect(page.getByText('Recruiter', { exact: true })).toBeVisible();
      await expect(page.getByText('Investor', { exact: true })).toBeVisible();
    });
});

async function seedCodesAndChats(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: HR_CODE, label: 'HR loop', purpose: 'spec',
  });
  await createCode(request, csrf, {
    code: INV_CODE, label: 'Investor intro', purpose: 'spec',
  });
  await chatViaCode(request, HR_CODE, 'Recruiter');
  await chatViaCode(request, INV_CODE, 'Investor');
}

async function chatViaCode(
  request: APIRequestContext, code: string, visitorName: string,
): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code, visitor_name: visitorName,
  });
  const res = await sendMessage(request, sess, 'hello');
  await res.body();
}

