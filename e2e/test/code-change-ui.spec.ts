// code-change-ui.spec.ts —— the owner changes a code's STRING from the Codes admin, through a WARNING
// modal (owner: "改的时候要有 modal warning … 你发出去的那些 resume、embed 等等就都会失效，你确定么").
// Positive UI flow: the change button opens a modal that WARNS what breaks; confirming rotates the code
// so the card now carries the new string.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createCode } from '@/fixtures/codes';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codechange@example.com', password: 'correct-horse-battery-staple',
  handle: 'codechange', fullName: 'Code Change Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('changing a code string from the admin (leak recovery)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: 'UI-OLDCODE', label: 'ui' });
    await request.dispose();
  });

  test('the change button warns what breaks, then rotates the code on confirm',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'codes');
      await expect(page.getByTestId('code-card-UI-OLDCODE')).toBeVisible({ timeout: 20_000 });

      // Change → a warning modal appears (it must state the impact, not just rotate silently).
      await page.getByTestId('code-change-UI-OLDCODE').click();
      const modal = page.getByTestId('code-change-modal');
      await expect(modal).toBeVisible();
      await expect(modal, 'the modal warns that already-sent copies stop working')
        .toContainText(/résumé|resume|stop working|简历|失效/i);

      // Enter a new string + confirm → the card now carries the new code, the old card is gone.
      await page.getByTestId('code-change-input').fill('UI-NEWCODE');
      await page.getByTestId('code-change-confirm').click();
      await expect(page.getByTestId('code-card-UI-NEWCODE')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('code-card-UI-OLDCODE')).toHaveCount(0);
    });
});
