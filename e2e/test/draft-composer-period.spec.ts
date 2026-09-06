// draft-composer-period.spec.ts —— the composer's experience/education period is TWO fields
// (from / to), not one. I (owner-reported, on sijie): "education 的 -present 是什么情况，range 是不是
// 没做对，实际上应该有第二个空". The composer flattened the résumé's `{start, end}` period into a single
// free-text "range" input, so `end` could never be set — the template then always printed
// "<start> – present". The résumé content and the Typst template both carry start+end; only the FORM
// was lossy.
//
// This drives the real form: add an experience, fill FROM and TO, save, reopen → both values persist
// (proving the round-trip form → API → load carries `end`). Then a from-only row keeps TO empty.
//
// RED with the single "range" input: there is no separate "to" field to fill; end stays null → the
// committed résumé says "present" for a role that ended.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-period@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftperiod', fullName: 'Draft Period Owner',
};

let draftID = '';

async function openComposerExperience(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.getByTestId(`draft-open-${draftID}`).first().click();
  await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('composer-panel-experience').click();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · period is two fields (from / to)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('fill from + to → both persist on reopen (end is not lost to "present")', async ({ adminPage: page }) => {
    await openComposerExperience(page);
    await page.getByTestId('composer-exp-add').click();

    const row = page.getByTestId('composer-exp-row-e-new-0');
    await row.getByTestId('composer-exp-from-e-new-0').fill('2020-01');
    await row.getByTestId('composer-exp-to-e-new-0').fill('2022-06');

    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 15_000 });

    // Reopen — the saved draft must carry BOTH dates (a single "range" string could not).
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('composer-panel-experience').click();

    const reopened = page.locator('[data-testid^="composer-exp-row-"]').first();
    await expect(reopened.getByTestId(/composer-exp-from-/), 'from persisted').toHaveValue('2020-01');
    await expect(reopened.getByTestId(/composer-exp-to-/), 'to persisted').toHaveValue('2022-06');
  });
});

async function seedDraft(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  const id = (await res.json() as { id: string }).id;
  await request.dispose();
  return id;
}
