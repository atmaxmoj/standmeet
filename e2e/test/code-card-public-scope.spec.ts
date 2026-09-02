// code-card-public-scope.spec.ts -- a code assigned the public role must not have its card
// say it "reads nothing" (UX-67).
//
// After F-D-7, the `public` identity **has no allow-list**: it reads whatever the owner has
// published, decided by each note's own toggle. The code card's "CORPUS · INHERITED FROM
// ROLE" field renders that list directly, and prints `(role grants nothing)` when it's
// empty -- so a public code gets described as "sees nothing", even though it can clearly
// read every published entry.
//
// This line is the owner's only way to tell "what can this code see", so getting it
// backwards is not a copy nit.
//
// RED (before the fix): the public card shows `(role grants nothing)`.

import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { getRoleByName } from '@/fixtures/roles';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'codescope@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codescope',
  fullName: 'Code Scope Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('codes · the card says what the code can actually read', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const publicRole = await getRoleByName(request, 'public');
    // A code explicitly assigned the public role (owner decided "this person only sees the public slice").
    await createCode(request, csrf, {
      code: 'PUBCARD-1', label: 'pubcard', assumed_role_id: publicRole.id,
    });
    // A code left blank (= invited), as the control: it has a real allow-list.
    await createCode(request, csrf, { code: 'INVCARD-1', label: 'invcard' });
    await request.dispose();
  });

  test('a public-scoped code is not described as reading nothing', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'codes');
    const pub = adminPage.getByTestId('code-corpus-PUBCARD-1');
    await expect(pub).toBeVisible({ timeout: 10_000 });
    // Run the positive control first: the invited card really does list globs -- otherwise
    // the "doesn't say nothing" assertion below could just mean this field never rendered.
    await expectInheritedGlobs(adminPage);
    await expect(
      pub,
      'a code on the public role reads the published slice — the card must not call that nothing',
    ).not.toContainText('grants nothing');
    await expect(pub, 'and it says what the scope actually is').toContainText(/published/i);
  });
});

async function expectInheritedGlobs(page: Page): Promise<void> {
  const inv = page.getByTestId('code-corpus-INVCARD-1');
  await expect(inv, 'the invited code card renders its inherited list').toContainText('wiki://**');
}
