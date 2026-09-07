// microsite-rename.spec.ts —— #6: a microsite's slug (its /p/<slug> address) is renamable, from
// the editor header ("the slug after /p should be editable"). Backend op microsite.rename; the
// reserved home page cannot be renamed; a collision with an existing slug is rejected.
//
// Access codes bind to a microsite by id, so a rename does not break their bindings — only direct
// /p/<oldslug> links change.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'kprename@example.com', password: 'correct-horse-battery-staple',
  handle: 'kprename', fullName: 'Rename Owner',
};

async function createPage(request: APIRequestContext, csrf: string, slug: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/microsites/`, {
    headers: { 'X-Csrftoken': csrf }, data: { slug, title: slug },
  });
  return res.status();
}

async function renamePage(
  request: APIRequestContext, csrf: string, slug: string, newSlug: string,
): Promise<number> {
  const res = await request.put(`${BACKEND}/api/admin/microsites/${slug}/slug`, {
    headers: { 'X-Csrftoken': csrf }, data: { new_slug: newSlug },
  });
  return res.status();
}

async function slugs(request: APIRequestContext, csrf: string): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/microsites`, { headers: { 'X-Csrftoken': csrf } });
  const rows = await res.json() as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite slug rename', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('rename changes the slug; collision and the reserved home slug are rejected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      expect(await createPage(request, csrf, 'old-name')).toBe(201);
      expect(await createPage(request, csrf, 'other-name')).toBe(201);

      // Happy path: old-name → fresh-name.
      expect(await renamePage(request, csrf, 'old-name', 'fresh-name')).toBe(200);
      const after = await slugs(request, csrf);
      expect(after, 'the new slug is present').toContain('fresh-name');
      expect(after, 'the old slug is gone').not.toContain('old-name');

      // Collision: renaming other-name onto the taken fresh-name is rejected.
      expect(await renamePage(request, csrf, 'other-name', 'fresh-name'),
        'renaming onto a taken slug is a conflict').toBe(409);

      // The reserved home slug cannot be renamed (it is pinned to `/`).
      expect(await renamePage(request, csrf, 'home', 'not-home'),
        'the homepage slug is reserved').toBe(400);
      await request.dispose();
    });

  test('the editor header name is editable in place; Save renames and lands on the new editor route',
    async ({ playwright, adminPage: page }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      expect(await createPage(request, csrf, 'ui-old')).toBe(201);
      await request.dispose();

      await goto(page, '/admin/edit/ui-old');
      await expect(page.getByTestId('microsite-editor')).toBeVisible({ timeout: 20_000 });
      // The name is an inline field pre-filled with the current slug (no "rename" reveal step).
      const nameField = page.getByTestId('microsite-name-input');
      await expect(nameField).toHaveValue('ui-old');
      await nameField.fill('ui-new');
      await page.getByTestId('microsite-name-save').click();
      await expect(page, 'Save renames and moves to the renamed editor route')
        .toHaveURL(/\/admin\/edit\/ui-new$/, { timeout: 15_000 });
    });

  test('the home page shows its DOMAIN in the header, not a /p/home slug',
    async ({ adminPage: page }) => {
      // home is served at the site root, so the editor header is the owner's domain surface, not an
      // editable /p/<slug> name (owner: "homepage 这边就应该显示域名").
      await goto(page, '/admin/edit/home');
      await expect(page.getByTestId('microsite-editor')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('microsite-home-domain')).toBeAttached();
    });

  test('clicking Save with the name unchanged flashes a ✓ acknowledgement',
    async ({ playwright, adminPage: page }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      expect(await createPage(request, csrf, 'ui-flash')).toBe(201);
      await request.dispose();

      await goto(page, '/admin/edit/ui-flash');
      await expect(page.getByTestId('microsite-editor')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('microsite-name-save').click();
      // A 1s ✓ confirms the click (the name didn't change, so it stays on this page).
      await expect(page.getByTestId('microsite-name-saved')).toBeVisible({ timeout: 2_000 });
      await expect(page).toHaveURL(/\/admin\/edit\/ui-flash$/);
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
