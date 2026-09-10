// asset-reference-recompute.spec.ts —— references are computed from content on every save
// (docs/design/global-assets.md "References are computed at save"). A corpus entry references
// exactly the pool assets its body cites (standmeet-asset:<id>) plus its cover; that set is
// recomputed on every create/update, and asset_references is set to exactly it.
//
// This is the reference-lifecycle half of the matrix the owner flagged as very error-prone —
// the classic bugs live here (a shared asset nuked when one referrer goes; an image edited out
// of a body still "in use"; a swap that leaves both or neither). Proven end to end through the
// real DB + MinIO, observing the actual references via GET /api/admin/assets/{id}/references.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import {
  createEntry, uploadAsset, setBody, setHero, MEDIA,
} from '@/fixtures/genre-assets';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'assetrecompute@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'assetrecompute',
  fullName: 'Asset Recompute Owner',
};

interface Session { request: APIRequestContext; token: string; sid: string }
interface Ref { kind: string; referrer_id: string }

let csrf = '';
let request: APIRequestContext;
let s: Session;

async function openOwnerSession(playwright: Playwright): Promise<void> {
  await initOwner(playwright);
  request = await playwright.request.newContext();
  ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  const token = await createAPIToken(request, csrf, 'asset-recompute');
  s = { request, token, sid: await initMCP(request, token) };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('asset references · recomputed from content on every save', () => {
  test.beforeAll(async ({ playwright }) => { await openOwnerSession(playwright); });

  test('citing an asset in a body references it; removing the citation frees it', async () => {
    // A lives in the pool, kept alive by a holder entry that attached it.
    const holder = await createEntry(s, 'wiki', 'Holder', 'holder body');
    const a = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel)).asset_id;
    const consumer = await createEntry(s, 'wiki', 'Consumer', 'no image yet');
    expect(referrerIDs(await refsOf(a)), 'consumer does not reference A yet')
      .not.toContain(consumer);

    await setBody(s, 'wiki', consumer, 'Consumer', `see standmeet-asset:${a}`);
    expect(referrerIDs(await refsOf(a)), 'citing A in the body references it')
      .toContain(consumer);

    await setBody(s, 'wiki', consumer, 'Consumer', 'the image is gone now');
    const after = referrerIDs(await refsOf(a));
    expect(after, 'removing the citation frees the reference').not.toContain(consumer);
    expect(after, 'the holder still references A').toContain(holder);
  });

  test('setting a cover references the asset; clearing the cover frees it', async () => {
    const holder = await createEntry(s, 'wiki', 'Cover Holder', 'body');
    const b = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel)).asset_id;
    const note = await createEntry(s, 'wiki', 'Cover Note', 'body');
    expect(referrerIDs(await refsOf(b))).not.toContain(note);

    await setHero(s, 'wiki', note, { cover_image_asset_id: b });
    expect(referrerIDs(await refsOf(b)), 'the cover references B').toContain(note);

    await setHero(s, 'wiki', note, { cover_image_asset_id: '' });
    expect(referrerIDs(await refsOf(b)), 'clearing the cover frees B').not.toContain(note);
  });

  test('swapping the body image A→B moves the reference, not both and not neither', async () => {
    const ha = await createEntry(s, 'wiki', 'HA', 'x');
    const a = (await uploadAsset(s, 'wiki', ha, MEDIA.pixel)).asset_id;
    const hb = await createEntry(s, 'wiki', 'HB', 'x');
    const b = (await uploadAsset(s, 'wiki', hb, MEDIA.gif)).asset_id;

    const note = await createEntry(s, 'wiki', 'Swap Note', `img standmeet-asset:${a}`);
    expect(referrerIDs(await refsOf(a)), 'A referenced first').toContain(note);
    expect(referrerIDs(await refsOf(b)), 'B not yet').not.toContain(note);

    await setBody(s, 'wiki', note, 'Swap Note', `img standmeet-asset:${b}`);
    expect(referrerIDs(await refsOf(a)), 'A freed after swap').not.toContain(note);
    expect(referrerIDs(await refsOf(b)), 'B referenced after swap').toContain(note);
  });

  test('deleting a note frees its references; the asset survives in the pool', async () => {
    const holder = await createEntry(s, 'wiki', 'Survive Holder', 'body');
    const c = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel)).asset_id;
    const note = await createEntry(s, 'wiki', 'Doomed', `pic standmeet-asset:${c}`);
    expect(referrerIDs(await refsOf(c))).toContain(note);

    await callTool(s.request, s.token, s.sid, 'corpus.delete', { genre: 'wiki', id: note });
    const after = referrerIDs(await refsOf(c));
    expect(after, "the deleted note's reference is gone").not.toContain(note);
    expect(after, 'the holder still references C — the asset lives on').toContain(holder);
    expect(await poolAssetIDs(), 'C survives in the pool').toContain(c);
  });

  test('a shared asset refuses delete until every referrer is gone', async () => {
    const holder = await createEntry(s, 'wiki', 'Shared Holder', 'body');
    const d = (await uploadAsset(s, 'wiki', holder, MEDIA.pixel)).asset_id;
    const n1 = await createEntry(s, 'wiki', 'Sharer 1', `a standmeet-asset:${d}`);
    const n2 = await createEntry(s, 'wiki', 'Sharer 2', `b standmeet-asset:${d}`);
    expect(referrerIDs(await refsOf(d))).toEqual(expect.arrayContaining([holder, n1, n2]));

    expect((await poolDelete(d)).status(), 'shared asset refuses delete').toBe(409);

    // free two of the three referrers — still refused while one remains
    await setBody(s, 'wiki', n1, 'Sharer 1', 'no image');
    await callTool(s.request, s.token, s.sid, 'corpus.delete', { genre: 'wiki', id: n2 });
    expect((await poolDelete(d)).status(), 'the holder still holds it').toBe(409);

    // free the last one → now it deletes
    await callTool(s.request, s.token, s.sid, 'assets.delete', {
      genre: 'wiki', id: holder, asset_id: d,
    });
    expect((await poolDelete(d)).status(), 'the last referrer gone → deletable').toBe(204);
    expect(await poolAssetIDs(), 'and it is gone from the pool').not.toContain(d);
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

function referrerIDs(refs: Ref[]): string[] {
  return refs.map((r) => r.referrer_id);
}

async function refsOf(assetID: string): Promise<Ref[]> {
  const res = await request.get(`${BACKEND}/api/admin/assets/${assetID}/references`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  return res.json() as Promise<Ref[]>;
}

async function poolAssetIDs(): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/assets`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  const assets = await res.json() as { asset_id: string }[];
  return assets.map((a) => a.asset_id);
}

// poolDelete —— the admin pool delete. This is an API-level reference-integrity test (the
// browser UI's delete is covered in assets-manager-ui.spec.ts), so it drives the admin
// endpoint directly, the same way global-assets-guard.spec.ts does.
function poolDelete(id: string) {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: asserts the reference-integrity delete-guard (409 while referenced, 204 once free)
  return request.delete(`${BACKEND}/api/admin/assets/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
}
