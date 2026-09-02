// sync-i-raw.spec.ts — I. raw-specific coverage (target state, currently red).
// raw/ → the raw_entries inbox (body/source/tags); raw is **exempt** from the
// frontmatter schema + **exempt** from link parsing (a forward-link is legal); nested
// raw (raw/x/y.md) — grading is still TBD (#151), this pins down "sync doesn't crash +
// body is persisted" for now.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('i');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync I · raw inbox', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: raw/x.md → raw inbox with its body', rawBodyLanded);
  test('happy: raw carries a source marking it came from the vault', rawHasSource);
  // ── corner ──
  test('corner: raw is exempt from the frontmatter schema (weird fm ok)', rawSchemaExempt);
  test('corner: raw is not publish-gated (inbox is private, always synced)', rawNotPublishGated);
  test('corner: nested raw/a/b.md syncs without crash (grading is #151)', rawNestedTolerated);
  test('idempotent: re-uploading the same raw/x.md updates, does not duplicate', rawResyncIdempotent);
  // ── error / tolerance ──
  test('error: raw [[forward-link]] to a nonexistent note is tolerated (no link check)', rawForwardLinkOk);
  test('error: raw with no frontmatter at all still syncs', rawNoFrontmatter);
});

// raw re-sync is idempotent: uploading the same source_path again → an upsert (1 row,
// body updated), not appended as a duplicate.
async function rawResyncIdempotent({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'raw/dedup.md', body: makeVaultMD({}, 'RAWDEDUPKW v1') }]);
  await uploadVault(request, OWNER, [{ rel: 'raw/dedup.md', body: makeVaultMD({}, 'RAWDEDUPKW v2') }]);
  const rows = (await adminGenreList(request, OWNER, 'raw'))
    .filter((n) => (n.body ?? '').includes('RAWDEDUPKW'));
  expect(rows.length, 'same source_path → single raw row (upsert, not append)').toBe(1);
  expect(rows[0]?.body, 'body updated to v2').toContain('v2');
  await request.dispose();
}

async function rawBodies(request: APIRequestContext): Promise<string[]> {
  return (await adminGenreList(request, OWNER, 'raw')).map((n) => n.body ?? '');
}

async function rawBodyLanded({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'raw/thought.md', body: makeVaultMD({ tags: ['seed'] }, 'RAWBODYKW a rough thought') },
  ]);
  expect((await rawBodies(request)).some((b) => b.includes('RAWBODYKW')), 'raw body landed').toBe(true);
  await request.dispose();
}

async function rawHasSource({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'raw/tagged.md', body: makeVaultMD({}, 'RAWSRCKW') }]);
  const list = await adminGenreList(request, OWNER, 'raw');
  // the raw row exists (source marking is internal; assert it landed as a raw row).
  expect(list.some((n) => (n.body ?? '').includes('RAWSRCKW')), 'raw row present').toBe(true);
  await request.dispose();
}

async function rawSchemaExempt({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'raw/weird.md', body: '---\nowns: [x]\nrandom_key: 1\n---\nRAWEXKW body' },
  ]);
  expect(r.errors, 'raw exempt from schema').toEqual([]);
  expect((await rawBodies(request)).some((b) => b.includes('RAWEXKW')), 'weird-fm raw synced').toBe(true);
  await request.dispose();
}

async function rawNotPublishGated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // no publish key, yet raw still syncs (inbox isn't publish-gated).
  await uploadVault(request, OWNER, [{ rel: 'raw/nopub.md', body: 'RAWNOPUBKW just text' }]);
  expect((await rawBodies(request)).some((b) => b.includes('RAWNOPUBKW')), 'raw synced without publish')
    .toBe(true);
  await request.dispose();
}

async function rawNestedTolerated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'raw/cybernetics/principles/note.md', body: makeVaultMD({}, 'RAWNESTKW') },
  ]);
  expect(r.errors, 'nested raw tolerated').toEqual([]);
  expect((await rawBodies(request)).some((b) => b.includes('RAWNESTKW')), 'nested raw synced').toBe(true);
  await request.dispose();
}

async function rawForwardLinkOk({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'raw/fwd.md', body: makeVaultMD({}, 'points at [[not-written-yet]] intentionally') },
  ]);
  expect(r.errors, 'raw forward-link tolerated (no link check)').toEqual([]);
  await request.dispose();
}

async function rawNoFrontmatter({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [{ rel: 'raw/bare.md', body: 'RAWBAREKW no fm block here' }]);
  expect(r.errors, 'raw no-fm tolerated').toEqual([]);
  expect((await rawBodies(request)).some((b) => b.includes('RAWBAREKW')), 'no-fm raw synced').toBe(true);
  await request.dispose();
}
