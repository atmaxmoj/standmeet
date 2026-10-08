// microsite-asset-serve-gate.spec.ts —— a bare asset id is public only through a page the public
// can open.
//
// Found by the outbound-surface inventory (2026-10-08): `serveAssetBlob` served an asset on its bare
// id whenever ANY microsite referenced it — a page closed to codeless visitors, or one taken down,
// still made its images world-readable to anyone holding the id. The rule the public serve route
// should keep is the page's own: if an anonymous reader cannot open the page, its assets need a
// signed URL like every corpus asset.
//
// Positive control first (an open, live page's asset streams), so a 404 below means "gated", not
// "the route is broken".

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';
import { publishPage } from '@/fixtures/microsite-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'asset-gate@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetgate', fullName: 'Asset Gate Owner',
};

let ctx: APIRequestContext;
let csrf = '';
const ids = { open: '', closed: '', gone: '' };

function pageSource(assetID: string): string {
  return `import { AssetWidget } from "@standmeet/sdk";
export default function App() {
  return <main><AssetWidget asset="standmeet-asset:${assetID}" alt="embedded" /></main>;
}
`;
}

// precondition: close / take down a page the way the owner's panel does
const admin = (method: 'put' | 'post', path: string, data: unknown) =>
  ctx[method](`${BACKEND}/api/admin/microsites${path}`, { headers: { 'X-Csrftoken': csrf }, data });

let anon: APIRequestContext; // no cookies, no token: what any stranger holding the id has
const anonymous = async (id: string) =>
  (await anon.get(`${BACKEND}/api/v1/assets/${id}`, { maxRedirects: 0 })).status();

test.describe('assets · a bare id is public only through a page the public can open', () => {
  test.describe.configure({ mode: 'serial', timeout: 900_000 });

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(900_000);
    resetInstance();
    ctx = await playwright.request.newContext();
    anon = await playwright.request.newContext();
    await claim(ctx, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(ctx, OWNER.email, OWNER.password));
    const token = await createAPIToken(ctx, csrf, 'asset-gate-seed');
    const s = { request: ctx, token, sid: await initMCP(ctx, token) };
    const holder = await createEntry(s, 'wiki', 'Asset Gate Holder', 'body');
    ids.open = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel, { filename: 'open.png' })).asset_id;
    ids.closed = (await uploadAsset(s, 'wiki', holder, MEDIA.gif, { filename: 'closed.gif' })).asset_id;
    ids.gone = (await uploadAsset(s, 'wiki', holder, MEDIA.webp, { filename: 'gone.webp' })).asset_id;

    await publishPage(ctx, csrf, 'open-gallery', pageSource(ids.open));
    await publishPage(ctx, csrf, 'closed-gallery', pageSource(ids.closed));
    expect((await admin('put', '/closed-gallery/open-without-code', { open_without_code: false })).status())
      .toBe(200);
    await publishPage(ctx, csrf, 'gone-gallery', pageSource(ids.gone));
    expect((await admin('post', '/gone-gallery/unpublish', {})).status()).toBe(200);
  });

  test.afterAll(async () => { await ctx.dispose(); await anon.dispose(); });

  test('an open, live page\'s asset streams on its bare id (control)', async () => {
    expect(await anonymous(ids.open)).toBe(200);
  });

  test('an asset referenced only by a page closed to codeless visitors is not served', async () => {
    expect(await anonymous(ids.closed)).toBe(404);
  });

  test('an asset referenced only by a taken-down page is not served', async () => {
    expect(await anonymous(ids.gone)).toBe(404);
  });
});
