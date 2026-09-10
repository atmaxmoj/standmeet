// global-assets-guard.spec.ts —— the heart of the global asset pool
// (docs/design/global-assets.md): an asset a corpus entry references CANNOT be deleted;
// once the reference is gone, it can. This is the invariant the owner flagged as most
// error-prone ("很容易错"), so it is proven end-to-end through the real DB + MinIO.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'assetguard@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'assetguard',
  fullName: 'Asset Guard Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('global asset pool · delete guard', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('a referenced asset refuses delete + names the referrer; freeing it lets it delete',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'assets-guard');
      const sid = await initMCP(request, token);
      const s = { request, token, sid };

      // attach an asset to a wiki entry → it enters the pool AND the entry references it
      const noteID = await createEntry(s, 'wiki', 'Guard Note', 'a body');
      const asset = await uploadAsset(s, 'wiki', noteID, MEDIA.pixel);

      expect(await poolAssetIDs(request, csrf)).toContain(asset.asset_id);

      // referenced → delete refused (409), and the message says by what
      const refused = await poolDelete(request, csrf, asset.asset_id);
      expect(refused.status()).toBe(409);
      expect((await refused.text()).toLowerCase()).toContain('corpus');
      // still in the pool after a refused delete
      expect(await poolAssetIDs(request, csrf)).toContain(asset.asset_id);

      // remove the asset from the entry (de-reference) — the asset survives in the pool
      await callTool(request, token, sid, 'assets.delete', {
        genre: 'wiki', id: noteID, asset_id: asset.asset_id,
      });
      expect(await poolAssetIDs(request, csrf)).toContain(asset.asset_id);

      // now unreferenced → the delete goes through, and it's gone from the pool
      const ok = await poolDelete(request, csrf, asset.asset_id);
      expect(ok.status()).toBe(204);
      expect(await poolAssetIDs(request, csrf)).not.toContain(asset.asset_id);
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

async function poolAssetIDs(request: APIRequestContext, csrf: string): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/assets`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  const assets = await res.json() as { asset_id: string }[];
  return assets.map((a) => a.asset_id);
}

function poolDelete(request: APIRequestContext, csrf: string, id: string) {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: the delete guard asserts a referenced asset → 409 and a freed asset → 204
  return request.delete(`${BACKEND}/api/admin/assets/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
}
