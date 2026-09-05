// draft-composer-ui.spec.ts —— the composer's owner-facing controls actually work from the browser
// (docs/design/resume-customization.md). Before this the composer was a facade: social/custom had
// no way to add a row, the template couldn't be picked, edits were discarded on close, and a fake
// "match /100" gauge sat in the top bar. This drives the real UI and proves, through a reopen:
//   - a social profile and a self-named custom section can be ADDED and persist;
//   - the Typst template can be picked and persists;
//   - the preview is the real Typst render (an <iframe>), and the fake match gauge is gone.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-ui@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftui', fullName: 'Draft UI Owner',
};

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · owner edits it from the browser and they persist', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('add a social profile + a named section, pick a template → all persist on reopen', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    // the fake match gauge is gone; the preview is the real Typst iframe
    await expect(page.getByTestId('composer-match-num'), 'the fake match gauge is removed')
      .toHaveCount(0);
    await expect(page.getByTestId('composer-preview-frame'), 'a real PDF preview iframe').toBeVisible();

    // add a social profile (the panel was un-fillable before — no add button)
    await page.getByTestId('composer-panel-social').click();
    await page.getByTestId('composer-social-add').click();
    await page.getByTestId('composer-social-handle-s-new-0').fill('@acand');

    // add a self-named custom section
    await page.getByTestId('composer-panel-custom').click();
    await page.getByTestId('composer-custom-add').click();
    await page.getByTestId('composer-custom-title-c-new-0').fill('Languages');

    // pick a Typst template
    await page.getByTestId('composer-template-picker').selectOption('compact');

    // wait for the real autosave to settle
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 15_000 });

    // reopen: everything persisted (the composer stopped discarding edits)
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('composer-template-picker'), 'template persisted')
      .toHaveValue('compact');
    await page.getByTestId('composer-panel-social').click();
    await expect(page.getByTestId('composer-social-handle-s-0'), 'social row persisted')
      .toHaveValue('@acand');
    await page.getByTestId('composer-panel-custom').click();
    await expect(page.getByTestId('composer-custom-title-c-0'), 'named section persisted')
      .toHaveValue('Languages');

    // SEND surfaces the code picker (the résumé↔code connection is now visible + choosable).
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('composer-code-picker'), 'the code picker is on the send modal')
      .toBeVisible();
    await expect(page.getByTestId('composer-code-new'), 'issue-a-new-code is the default option')
      .toBeVisible();
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
