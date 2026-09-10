// asset-upload-dedup.spec.ts —— uploading the SAME picture twice must not grow the pool.
//
// Business story: the owner references one logo on several entries, or re-runs a vault sync. Each
// upload today (`assets.upload` / the obsidian import / the admin picker) mints a fresh pool row —
// SHA256 is stored on every asset but nothing looks it up before insert, so the pool only grows and
// fills with byte-identical copies. Observed live on prod: the same `logo-512.png` uploaded twice →
// two pool rows (`ef69b117…` + `c46f023f…`), same 436877 bytes.
//
// The dedup key the owner specified is **filename + image content** (not content alone): the same
// name AND the same bytes is "the same file, again" → reuse the existing pool asset; a different
// name, or different bytes, is a distinct asset. So:
//
//   (name A, bytes P) then (name A, bytes P)  → ONE asset  (dedup — tests 1 + 4, RED today)
//   (name A, bytes P) then (name B, bytes P)  → TWO assets (name is part of the key — test 2)
//   (name A, bytes P) then (name A, bytes Q)  → TWO assets (content is part of the key — test 3)
//
// The whole point is `asset_id` equality vs inequality: dedup returns the SAME id the first upload
// got. Tests 2/3 pass today AND after the fix — they pin the key to name+content so a content-only
// (or name-only) dedup can't satisfy this suite.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { MEDIA, createEntry, uploadAsset } from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'asset-dedup@example.com', password: 'correct-horse-battery-staple',
  handle: 'asset-dedup', fullName: 'Asset Dedup Owner',
};

interface MCPSession { request: APIRequestContext; token: string; sid: string }
interface PoolAsset { asset_id: string; original_filename: string; size_bytes: number }
let s: MCPSession;
let entry: string;

// poolCount —— how many assets sit in the owner's global pool right now (MCP assets.list, the same
// surface the Assets panel reads). Used to prove dedup at the pool level, not just in the return value.
async function poolCount(): Promise<number> {
  const pool = await callTool<PoolAsset[]>(s.request, s.token, s.sid, 'assets.list', {});
  return pool.length;
}

test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'asset-dedup-token');
  s = { request, token, sid: await initMCP(request, token) };
  entry = await createEntry(s, 'wiki', 'dedup host', 'body');
});

test.afterAll(async () => { await s.request.dispose(); });

test.describe('asset upload dedups on filename + content', () => {
  test('the same name + same image reuses the one pool asset (does not duplicate)', async () => {
    const first = await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'same.png' });
    const again = await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'same.png' });
    expect(again.asset_id, 'same filename + same bytes must reuse the existing pool asset')
      .toBe(first.asset_id);
  });

  test('a different filename with the same bytes is a distinct asset (name is part of the key)', async () => {
    const a = await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'name-a.png' });
    const b = await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'name-b.png' });
    expect(b.asset_id, 'same bytes but a different name is a different file — never dedup across names')
      .not.toBe(a.asset_id);
  });

  test('the same filename with different bytes is a distinct asset (content is part of the key)', async () => {
    const png = await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'shared.png' });
    const webp = await uploadAsset(s, 'wiki', entry, MEDIA.webp, { filename: 'shared.png' });
    expect(webp.asset_id, 'same name but different bytes is a different image — never dedup across content')
      .not.toBe(png.asset_id);
  });

  test('re-uploading the identical file N times adds exactly one pool row', async () => {
    const before = await poolCount();
    for (let i = 0; i < 3; i++) {
      await uploadAsset(s, 'wiki', entry, MEDIA.pixel, { filename: 'count-once.png' });
    }
    expect(await poolCount() - before, 'three identical uploads must add one pool asset, not three')
      .toBe(1);
  });
});
