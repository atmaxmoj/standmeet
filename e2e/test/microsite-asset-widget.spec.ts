// microsite-asset-widget.spec.ts —— a microsite embeds a pool asset via the SDK AssetWidget, and
// the whole loop holds end to end (docs/design/global-assets.md, microsite side):
//   - on build, the microsite's source is scanned for standmeet-asset:<id> and the asset gains a
//     'microsite' reference (RebuildMicrositeAssetRefs, hooked into the build lifecycle);
//   - the delete guard then refuses to delete that asset, naming the microsite;
//   - the public serve route (GET /api/v1/assets/{id}) is a THIN pass-through: it reads the asset's
//     bytes from object storage over the internal network and streams them (no presigned redirect,
//     minio never exposed). Served by (unguessable) id — the id is the capability, exactly as the
//     presigned URL was.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry, uploadAsset, MEDIA } from '@/fixtures/genre-assets';
import { publishPage } from '@/fixtures/microsite-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'ms-asset@example.com', password: 'correct-horse-battery-staple',
  handle: 'msasset', fullName: 'Microsite Asset Owner',
};

interface Ref { kind: string; referrer_id: string }

let ctx: APIRequestContext;
let csrf = '';
// embedded — a pool asset the microsite embeds; corpusOnly — a pool asset no microsite references.
let embedded = '';
let corpusOnly = '';

function pageSource(assetToken: string): string {
  return `
import { AssetWidget } from "@standmeet/sdk";
export default function App() {
  return (
    <main>
      <h1 data-sm="marker">ASSET PAGE</h1>
      <AssetWidget asset="${assetToken}" alt="embedded" />
    </main>
  );
}
`.trim();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsite asset widget · reference + guard + public serve', () => {
  test.beforeAll(async ({ playwright }) => {
    await setup(playwright);
  });

  test('embedding a pool asset in a page references it, guards its delete, and serves it', async () => {
    // Before the build: the embedded asset is referenced only by its corpus holder, no microsite.
    expect(kindsOf(await refsOf(embedded)), 'no microsite reference yet').not.toContain('microsite');

    // Publish a microsite whose source embeds the asset via <AssetWidget> → on build, the scan
    // records a 'microsite' reference.
    await publishPage(ctx, csrf, 'gallery', pageSource(`standmeet-asset:${embedded}`));
    await expect
      .poll(async () => kindsOf(await refsOf(embedded)), { timeout: 15_000 })
      .toContain('microsite');

    // Delete guard: the asset a live page embeds cannot be deleted — the message names the microsite.
    const refused = await ctx.delete(`${BACKEND}/api/admin/assets/${embedded}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(refused.status(), 'a microsite-embedded asset refuses delete').toBe(409);
    expect((await refused.text()).toLowerCase()).toContain('microsite');

    // Public serve: the route is a thin pass-through. It STREAMS the asset's bytes (200 + image
    // content-type + a real body) instead of 302-redirecting to a presigned minio URL — so the blob
    // rides the instance's own HTTPS origin and minio is never exposed.
    const served = await ctx.get(`${BACKEND}/api/v1/assets/${embedded}`, { maxRedirects: 0 });
    expect(served.status(), 'a referenced asset streams its bytes (not a redirect)').toBe(200);
    expect(served.headers()['content-type'] ?? '', 'streamed as an image').toContain('image');
    expect((await served.body()).length, 'a real body, not an empty redirect').toBeGreaterThan(0);

    // No reference-ACL: a corpus-only asset is served too — served by its (unguessable) id, the same
    // capability model the presigned URL had.
    const other = await ctx.get(`${BACKEND}/api/v1/assets/${corpusOnly}`, { maxRedirects: 0 });
    expect(other.status(), 'a corpus-only asset also streams (served by id)').toBe(200);

    // An unknown id is a plain 404.
    const missing = await ctx.get(
      `${BACKEND}/api/v1/assets/00000000-0000-4000-8000-000000000000`, { maxRedirects: 0 });
    expect(missing.status(), 'an unknown asset id is 404').toBe(404);
  });
});

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  ctx = await playwright.request.newContext();
  await claim(ctx, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(ctx, OWNER.email, OWNER.password));
  const token = await createAPIToken(ctx, csrf, 'ms-asset-seed');
  const sid = await initMCP(ctx, token);
  const s = { request: ctx, token, sid };
  const holder = await createEntry(s, 'wiki', 'Asset Holder', 'body');
  embedded = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel, { filename: 'embed.png' })).asset_id;
  const other = await createEntry(s, 'wiki', 'Other Holder', 'body');
  corpusOnly = (await uploadAsset(s, 'wiki', other, MEDIA.gif, { filename: 'private.gif' })).asset_id;
}

function kindsOf(refs: Ref[]): string[] {
  return refs.map((r) => r.kind);
}

async function refsOf(assetID: string): Promise<Ref[]> {
  const res = await ctx.get(`${BACKEND}/api/admin/assets/${assetID}/references`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  return res.json() as Promise<Ref[]>;
}
