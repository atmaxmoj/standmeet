// microsite-editor-view-toggle.spec.ts — the editor has a layout gear: code-only / split / render.
//
// The owner asked for the three positions (2026-09-06): see just the IDE, just the render, or the
// current side-by-side. Split is the default. Toggling hides a column (CSS, not unmount) so the
// code and preview keep their state across switches.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'viewtoggle@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'viewtoggle',
  fullName: 'View Toggle Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsites · editor layout gear (code / split / render)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the gear shows code-only, render-only, or the split — split by default', async ({ adminPage: page }) => {
    await goto(page, '/admin/edit/new');
    await expect(page.getByTestId('microsite-editor')).toBeVisible();
    const code = page.getByTestId('microsite-code-col');
    const render = page.getByTestId('microsite-render-col');

    // default: split — both panes present.
    await expect(code, 'split shows the code column').toBeVisible();
    await expect(render, 'split shows the render column').toBeVisible();

    // code-only — the render column is hidden, the code stays.
    await page.getByTestId('editor-view-code').click();
    await expect(code).toBeVisible();
    await expect(render, 'code-only hides the render').toBeHidden();

    // render-only — the code column is hidden, the render shows.
    await page.getByTestId('editor-view-render').click();
    await expect(code, 'render-only hides the code').toBeHidden();
    await expect(render).toBeVisible();

    // back to split — both again.
    await page.getByTestId('editor-view-split').click();
    await expect(code).toBeVisible();
    await expect(render).toBeVisible();
  });
});
