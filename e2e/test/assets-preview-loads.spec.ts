// assets-preview-loads.spec.ts — an uploaded image in Resources → 素材 (Assets) must actually
// DISPLAY. The owner reported the panel "素材显示不了": the cards were there but the previews came up
// broken, because the presigned URL pointed at a host:port the browser could not reach.
//
// The honest shape (owner's own recipe): capture the BEFORE state (empty) → upload a distinctive
// solid-colour image → read the URL the panel actually renders in its <img> → VISIT that URL and
// decode its bytes → assert the served pixels ARE the image we uploaded (same colour). A DOM-presence
// check is blind to a broken URL; fetching the real URL and comparing pixels is not — an unreachable
// host/port, a 404, or a wrong asset all fail here.
//
// Scope note: the prod incident was a config one (STORAGE_PUBLIC_URL carried :9000, which Cloudflare
// can't reach on 443) — fixed in deployment, not code. This guards the capability the symptom named:
// "a picked image actually shows in the panel", verified end-to-end against the URL the panel serves.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { avgColor, solidPNG } from '@/fixtures/pixel-compare';

const OWNER = {
  email: 'assets-preview@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetspreview', fullName: 'Assets Preview Owner',
};

// A distinctive solid colour, so the served bytes can be matched to THIS upload (not a stale/other one).
const RED = { r: 201, g: 42, b: 37 };
const RED_PNG = solidPNG(RED.r, RED.g, RED.b);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Resources → 素材 · an uploaded image actually displays', () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the panel renders an <img> whose URL, when visited, serves the uploaded image', async ({
    adminPage: page,
  }) => {
    test.setTimeout(90_000);
    // Reach Assets by CLICKING the Resources nav (never a goto teleport).
    await page.getByTestId('admin-nav-assets').click();
    // BEFORE — a fresh owner has uploaded nothing, so the panel is empty (proves the card came from us).
    await expect(page.getByTestId('assets-empty')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('assets-upload').setInputFiles({
      name: 'red-shot.png', mimeType: 'image/png', buffer: RED_PNG,
    });

    const card = page.getByTestId(/^asset-card-/).first();
    await expect(card, 'the uploaded asset card appears').toBeVisible({ timeout: 15_000 });
    const img = card.locator('img');
    await expect(img, 'the card renders an <img> preview').toBeVisible();

    // AFTER — the browser decoded real pixels (not a broken image).
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), {
        message: 'the asset image preview actually loads (naturalWidth > 0)', timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // VISIT the URL the panel renders — this is what catches an unreachable host/port, a 404, or the
    // wrong asset. The signed URL must return 200 + image bytes.
    const src = await img.getAttribute('src');
    expect(src, 'the img has a src URL').toBeTruthy();
    const served = await page.request.get(src as string);
    expect(served.status(), `the asset URL ${src} is reachable`).toBe(200);
    expect(served.headers()['content-type'] ?? '', 'the URL serves an image').toContain('image');

    // COMPARE — the served bytes ARE the image we uploaded: its mean colour is the red we sent, not a
    // placeholder, an error page, or some other asset.
    const got = avgColor(await served.body());
    expect(Math.abs(got.r - RED.r), 'served image red channel matches the upload').toBeLessThan(24);
    expect(Math.abs(got.g - RED.g), 'served image green channel matches the upload').toBeLessThan(24);
    expect(Math.abs(got.b - RED.b), 'served image blue channel matches the upload').toBeLessThan(24);
  });
});
