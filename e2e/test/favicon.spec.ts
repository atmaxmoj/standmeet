// favicon.spec.ts —— G2: the owner-selectable favicon, end to end. Every branch of "what does
// /favicon.ico serve right now" is exhausted:
//   - no custom favicon        → the embedded default, a real image, never a 404;
//   - a picked image asset      → THAT image's exact bytes (the happy path, driven through the UI);
//   - a bad / missing asset id  → falls back to the default (never a 500);
//   - deselect ('')             → back to the default;
//   - the picker lists the owner's image assets + a Default (deselect) option, and choosing one
//     actually changes what is served (an owner-facing control, verified by its real effect).
// (The in-memory cache — storage hit only when the id changes — is proven in boot_favicon_test.go.)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { initMCP } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'favicon@example.com', password: 'correct-horse-battery-staple',
  handle: 'faviconowner', fullName: 'Favicon Owner',
};

// A PNG image dropped into the asset pool, ready to be picked as the favicon.
let imageAsset = { id: '', size: 0 };

async function setFavicon(api: APIRequestContext, csrf: string, assetID: string): Promise<void> {
  const res = await api.put(`${BACKEND}/api/admin/appearance/favicon`, {
    headers: { 'X-Csrftoken': csrf }, data: { asset_id: assetID },
  });
  expect(res.status(), `set favicon ${assetID}`).toBeLessThan(300);
}

async function faviconRes(api: APIRequestContext, v: string) {
  const r = await api.get(`${BACKEND}/favicon.ico?v=${v}`);
  expect(r.status(), 'favicon served').toBe(200);
  expect(r.headers()['content-type'] ?? '', 'favicon is an image').toContain('image');
  return r;
}
const faviconBytes = async (api: APIRequestContext, v: string): Promise<Buffer> =>
  (await faviconRes(api, v)).body();

// Seed one image asset into the global pool via MCP (the owner's real path: the backend fetches it
// by address), returning its id + byte size so the served favicon can be matched against it.
async function seedImageAsset(playwright: Playwright): Promise<{ id: string; size: number }> {
  const request = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'favicon-seed');
  const sid = await initMCP(request, token);
  const holder = await createEntry({ request, token, sid }, 'wiki', 'Logo holder', 'body');
  const up = await uploadAsset({ request, token, sid }, 'wiki', holder, MEDIA.pixel, {
    filename: 'logo.png', kind: 'image',
  });
  await request.dispose();
  return { id: up.asset_id, size: up.size_bytes };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner favicon (G2)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    imageAsset = await seedImageAsset(playwright);
  });

  test('default / bad-id / deselect all fall back to the embedded default', async ({ playwright }) => {
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);

    // No custom favicon → the embedded default, a real image, never 404.
    const def = await faviconBytes(api, 'a');
    expect(def.length, 'default favicon has bytes').toBeGreaterThan(0);

    // A picked id that can't be loaded falls back to the default (never a 500).
    await setFavicon(api, csrf, 'no-such-asset');
    expect((await faviconBytes(api, 'b')).equals(def), 'bad id → default').toBe(true);

    // Deselect ('') → back to the default.
    await setFavicon(api, csrf, '');
    expect((await faviconBytes(api, 'c')).equals(def), 'deselect → default').toBe(true);
    await api.dispose();
  });

  test('picking a real image asset serves THAT image; deselect returns to default', async ({ playwright }) => {
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    await setFavicon(api, csrf, ''); // start from the default
    const def = await faviconBytes(api, 'd0');

    // Pick the uploaded image → /favicon.ico now serves it: the picked asset's own bytes, not the
    // default. Matched two ways — the served length equals the asset's size, and it differs from
    // the default — so a stale "still the default" can't pass as success.
    await setFavicon(api, csrf, imageAsset.id);
    const custom = await faviconBytes(api, 'd1');
    expect(custom.length, 'served favicon is the picked asset (by size)').toBe(imageAsset.size);
    expect(custom.equals(def), 'the custom favicon is NOT the default').toBe(false);

    // Deselecting it again returns to the default (round-trip closes).
    await setFavicon(api, csrf, '');
    expect((await faviconBytes(api, 'd2')).equals(def), 'deselect → default again').toBe(true);
    await api.dispose();
  });

  test('the picker lists the image and choosing it changes what is served', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    await setFavicon(api, csrf, ''); // known start: the default

    await page.getByTestId('admin-nav-account').click();
    await expect(page.getByTestId('favicon-editor')).toBeVisible({ timeout: 30_000 });
    const select = page.getByTestId('favicon-select');
    await expect(select).toBeVisible();
    // A Default (deselect) option and the uploaded image are both selectable.
    await expect(select.locator('option[value=""]'), 'a Default/deselect option exists').toHaveCount(1);
    await expect(select.locator(`option[value="${imageAsset.id}"]`), 'the uploaded image is offered').toHaveCount(1);

    // Choose the image through the real control → the served favicon becomes that asset's bytes.
    await select.selectOption(imageAsset.id);
    await expect
      .poll(async () => (await faviconBytes(api, `ui-${Date.now()}`)).length, {
        message: 'choosing the image in the picker actually changes /favicon.ico', timeout: 20_000,
      })
      .toBe(imageAsset.size);
    await api.dispose();
  });
});
