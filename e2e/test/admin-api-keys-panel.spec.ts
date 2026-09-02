// admin-api-keys-panel.spec.ts — F-K-1: outward API keys must be visible, mintable,
// and revocable from the admin panel.
//
// **Why this is a security line, not a convenience**: today an outward key can only
// be managed over owner-MCP (`api_keys.create/list/revoke` are all `Reach: mcpOnly()`).
// So a leaked key **can only be revoked once the owner has an MCP client installed and
// running**. My own revoke of the keys I mint in this test takes exactly that path,
// because there is no second one.
//
// The design already declared the two facades twins (`docs/design/facade-directions.md:202-206`,
// verbatim):
//   Admin HTTP: /api/admin/api-keys CRUD (mint returns the secret once) + revoke + rate override…
//   **Admin UI: an "api" section (keys list + mint + revoke; candidates toggle list)**
//   Owner-MCP **twins**: api_keys.create/list/revoke/update…
// The same page also states "owner-plane ratchet forces twins by construction". Only the
// MCP half was ever built, and the reach comment at `ops/api_keys.go:37` argues the
// opposite direction — "the panel has no page for it" — **using the absence as its own
// justification**. This guard pins down that missing half.
//
// **Asserting that the list shows no plaintext right after minting is one of the main
// points of this case**: the list must never become a place to scrape a key from. The
// plaintext is shown once, at the moment of minting, and only the prefix survives after.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'apikeys-panel@example.com', password: 'correct-horse-battery-staple',
  handle: 'apikeyspanel', fullName: 'API Keys Panel Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-K-1 · outward API keys are managed from the admin panel, not only over MCP', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('mint → the secret shows once and the list keeps only the prefix → revoke kills it',
    async ({ adminPage, playwright }) => {
      await goto(adminPage, '/admin/api-mcp');

      // Positive control: the panel actually renders. Without this, every assertion
      // below would fail with "element not found", and the failure would get blamed
      // on a missing feature ([[red-in-the-wrong-place]]).
      const panel = adminPage.getByTestId('api-keys-panel');
      await expect(panel, 'the api-keys panel is on the page at all').toBeVisible({ timeout: 15_000 });

      await adminPage.getByTestId('api-key-new-label').fill('panel-minted');
      await adminPage.getByTestId('api-key-new-create').click();

      // The plaintext is given only once — it must be visible right at the moment of
      // minting, or the owner can never get it.
      const secretBox = adminPage.getByTestId('api-key-new-secret');
      await expect(secretBox, 'the raw secret is shown once, right after minting')
        .toBeVisible({ timeout: 10_000 });
      const secret = (await secretBox.innerText()).trim();
      expect(secret, 'and it is a real smk_ key').toMatch(/^smk_\S{20,}$/);

      // It genuinely works — not just a nice-looking string.
      expect(await facadeStatus(playwright, secret), 'the minted key authenticates').toBe(200);

      // Only the prefix survives in the list: this page must not become a place to
      // scrape a key from.
      //
      // **Wait for the row itself, not for the panel**: the panel appears immediately
      // with its heading, but the list only fills in once a request comes back. My
      // first version waited for `api-keys-panel` to be visible and then read
      // innerText, which read the still-empty shell — the same mistake made twice
      // tonight ([[red-in-the-wrong-place]]).
      await goto(adminPage, '/admin/api-mcp');
      const revokeBtn = adminPage.getByTestId('api-key-revoke-panel-minted');
      await expect(revokeBtn, 'the key survived the reload and is listed')
        .toBeVisible({ timeout: 15_000 });
      const listed = await adminPage.getByTestId('api-keys-panel').innerText();
      expect(listed, 'but the full secret is not on the page').not.toContain(secret);

      // Revoke — this is the heart of this finding: after a leak, the owner can shut
      // it off themselves.
      adminPage.once('dialog', (d) => { void d.accept(); });
      await revokeBtn.click();
      await expect(async () => {
        expect(await facadeStatus(playwright, secret), 'the revoked key stops working').toBe(401);
      }).toPass({ timeout: 15_000 });
    });
});

// facadeStatus — hits the outward facade once with this key and returns the status
// code. Whether the key works is answered by **the product itself**, not by wording
// on the page ([[nonunique-signal-not-a-receipt]]).
async function facadeStatus(playwright: Playwright, secret: string): Promise<number> {
  const r = await playwright.request.newContext();
  const res = await r.get(`${BACKEND}/api/pub/v1/tools`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  await r.dispose();
  return res.status();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createRole(request, csrf, {
    name: 'panel-role', description: 'api keys panel spec',
    corpus_uris: ['wiki://**'],
  });
  await request.dispose();
}

export type { Page };
