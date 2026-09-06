// draft-composer-reorder.spec.ts —— the composer's repeatable sections can be reordered by drag
// (docs/design/composer-visual-editor.md, Phase 1). The committed résumé renders sections in the
// draft's array order, so dragging a row must reorder that array AND persist — otherwise "drag to
// reorder" is a cosmetic gesture the PDF ignores.
//
// This drives the real drag handle: add two experience rows (Alpha, then Beta), drag Beta's handle
// onto Alpha's row → the order flips to [Beta, Alpha], and a reopen proves it persisted.
//
// RED without the reorder wiring: the drag is a no-op, the first row stays Alpha.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Locator, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-reorder@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftreorder', fullName: 'Draft Reorder Owner',
};

let draftID = '';

// firstExpOrg —— the `org` input of whichever experience row is rendered first (org is the row's
// first <input>). Reading by position, not id, so it survives the id change a reopen brings.
function firstExpOrg(page: Page): Locator {
  return page.locator('[data-testid^="composer-exp-row-"]').first().locator('input').first();
}

async function openComposerExperience(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.getByTestId(`draft-open-${draftID}`).first().click();
  await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('composer-panel-experience').click();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · drag reorders sections and it persists', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('drag Beta above Alpha → order flips → persists on reopen', async ({ adminPage: page }) => {
    await openComposerExperience(page);

    // Two roles: Alpha (e-new-0), then Beta (e-new-1).
    await page.getByTestId('composer-exp-add').click();
    await firstExpOrg(page).fill('AlphaOrg');
    await page.getByTestId('composer-exp-add').click();
    // Beta is the second row; target its org via its row.
    await page.getByTestId('composer-exp-row-e-new-1').locator('input').first().fill('BetaOrg');

    await expect(firstExpOrg(page), 'Alpha starts first').toHaveValue('AlphaOrg');

    // Drag Beta's handle onto Alpha's row.
    await page.getByTestId('composer-exp-drag-e-new-1')
      .dragTo(page.getByTestId('composer-exp-row-e-new-0'));

    await expect(firstExpOrg(page), 'after the drag, Beta is first').toHaveValue('BetaOrg');

    // Autosave settles, then a reopen proves the new order is what got saved (not just local state).
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 15_000 });
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('composer-panel-experience').click();
    await expect(firstExpOrg(page), 'reordered order persisted').toHaveValue('BetaOrg');

    // …and it reached the ARTIFACT: the rendered PDF lists the experience in the new order, so the
    // drag actually changed the résumé a recruiter sees — not just the form ("看是否拖拽成功").
    const res = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}/preview.pdf`);
    expect(res.status(), 'preview.pdf renders').toBe(200);
    const { text } = await inspectPDF(await res.body());
    expect(text.indexOf('BetaOrg'), 'Beta appears in the PDF').toBeGreaterThanOrEqual(0);
    expect(text.indexOf('BetaOrg'), 'Beta renders before Alpha in the PDF').toBeLessThan(text.indexOf('AlphaOrg'));
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
