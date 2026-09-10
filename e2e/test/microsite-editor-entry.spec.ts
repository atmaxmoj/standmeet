// microsite-editor-entry.spec.ts —— opening a microsite editor auto-builds a preview.
//
// #4 "每次点进去自动触发一下build preview": opening an existing page now auto-builds a preview,
// so the render on the right is fresh without a manual "build preview" click.
//
// (The sibling fix #3 — a loading.tsx skeleton so clicking a page's name navigates at once instead
// of freezing on the old screen — is a pure Suspense-fallback presentation change with no behaviour
// to assert here: that the edit link navigates to the editor is already covered by
// owner-homepage-edit-entry.spec.ts, and loading.tsx only shows while the segment streams, which
// can't be forced deterministically without a banned sleep.)

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'editorentry@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'editorentry',
  fullName: 'Editor Entry Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite editor entry', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  // #4 — opening an existing page auto-builds; the build status line appears with no manual click.
  test('opening an existing page auto-builds a preview (no manual build click)',
    async ({ adminPage: page }) => {
      await openReader(page, '/admin/edit/home');
      await expect(page.getByTestId('microsite-editor')).toBeVisible({ timeout: 20_000 });
      // Nobody clicked "build preview" — openExisting kicks off stageFiles on entry, so the build
      // status line shows on its own. RED before the fix: no build runs until the button is clicked.
      await expect(page.getByTestId('microsite-build-status'), 'a build kicks off on entry')
        .toBeVisible({ timeout: 30_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
