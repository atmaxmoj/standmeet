// custom-page-preview-before-publish.spec.ts — the owner can SEE the page before it
// goes live, right where they write it.
//
// Why this file exists: the authoring panel used to write blind — a bare textarea and
// one "build + publish" button that shipped straight to /p/<slug>. The owner's words,
// touring the live instance: "at least give me a simple editor — writing here, I can't
// see the effect at all." So the panel now has two actions:
//   · Build preview — stages a build and renders it inline, WITHOUT going live.
//   · Publish → live — promotes it.
//
// The criterion is the split itself: **after Build preview, the page renders inline but
// the visitor URL is still dark**; only Publish lights it up. A test that just checked
// "the preview shows the content" would pass even if Build preview had quietly gone live
// — which is the exact mistake this feature removes.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto, reloadAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'previewfirst@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'previewfirst',
  fullName: 'Preview First Owner',
};

const SLUG = 'press-kit';
const MARKER = 'STAGED_BEFORE_LIVE_MARKER';
const APP = `export default function App() {\n  return <main><h1>${MARKER}</h1></main>;\n}`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('custom pages · preview before publish', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // The two buttons must state what they can't do yet — both are dead without a slug,
  // and saying so (disabled) is not the same as a dead button (F-N-1's shape).
  test('the editor is fillable and both actions gate on the slug', async ({ adminPage: page }) => {
    await reloadAdminSection(page, 'custom-pages');
    await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });

    await expect(page.getByTestId('custom-page-source')).toBeVisible();
    await expect(page.getByTestId('custom-page-build')).toBeDisabled();
    await expect(page.getByTestId('custom-page-publish')).toBeDisabled();

    await page.getByTestId('custom-page-slug').fill('anything');
    await expect(page.getByTestId('custom-page-build')).toBeEnabled();
    await expect(page.getByTestId('custom-page-publish')).toBeEnabled();

    // The editor is a real, fillable field (the @uiw editor's inner <textarea>).
    await page.getByTestId('custom-page-source').fill(APP);
    await expect(page.getByTestId('custom-page-source')).toHaveValue(new RegExp(MARKER));
  });

  // The whole point: staged renders inline, and the visitor URL is STILL dark until publish.
  test('build preview renders inline but does not go live; publish does', async ({ adminPage: page }) => {
    // Two real sandbox builds may queue behind this one (one-at-a-time builder), so the
    // budget is for queueing, not for a build that never comes ([[red-in-the-wrong-place]]).
    test.setTimeout(300_000);
    await buildPreview(page, SLUG, APP);

    // 1. It renders inline — the staging iframe shows the page's heading.
    await expect(
      page.frameLocator('[data-testid="custom-page-staging-frame"]').getByRole('heading', { name: MARKER }),
      'the staged build renders in the panel',
    ).toBeVisible({ timeout: 30_000 });

    // 2. **But it is not live** — the visitor URL is still dark. This is the criterion
    //    that fails if "build preview" ever quietly promoted.
    const beforePublish = await page.request.get(`/api/v1/custom-pages/${SLUG}`);
    expect(beforePublish.status(), 'a staged-only page must not serve to visitors')
      .toBeGreaterThanOrEqual(400);

    // 3. Publish promotes the build already staged (no rebuild) → the visitor URL lights up.
    await page.getByTestId('custom-page-publish').click();
    await expect.poll(async () => {
      const after = await page.request.get(`/api/v1/custom-pages/${SLUG}`);
      return after.status();
    }, { message: 'after publish the visitor URL serves', timeout: 60_000 }).toBe(200);

    // And the live page really carries the content (panel "success" is not the criterion).
    await goto(page, `/p/${SLUG}`);
    await expect(page.getByRole('heading', { name: MARKER })).toBeVisible({ timeout: 20_000 });
  });
});

// buildPreview — fill the panel, click **Build preview** (not publish), and wait for the
// build to reach a terminal state. Only waits for terminal: asserting "still building"
// holds for any implementation.
async function buildPreview(page: Page, slug: string, source: string): Promise<void> {
  await reloadAdminSection(page, 'custom-pages');
  await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
  await page.getByTestId('custom-page-slug').fill(slug);
  await page.getByTestId('custom-page-source').fill(source);
  await page.getByTestId('custom-page-build').click();
  await expect(page.getByTestId('custom-page-build-status'))
    .toHaveText(/built/i, { timeout: 180_000 });
}
