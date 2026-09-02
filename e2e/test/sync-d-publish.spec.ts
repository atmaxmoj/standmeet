// sync-d-publish.spec.ts -- D. `publish` is a **visibility** gate, not a storage gate
// (F-L-8).
//
// Two orthogonal decisions used to be locked together by the same frontmatter flag:
//   - stored (enters the corpus) -- every .md routed in from the vault is **always**
//     stored. The agent needs to be able to ground on it.
//   - public (published, formerly named seo_indexed) -- controls only whether
//     **anonymous visitors** can see it / whether it enters the sitemap.
//     `Visibility goes through scope: anonymous sees only published entries, a code goes
//     through the role's corpus_uris glob admission` (wiki_tree.go). published=false does
//     not mean "doesn't exist", it means "needs a code to see" -- the public /wiki route
//     itself is labeled `... AS gated`.
//
// Previously, a leaf with publish:false / no publish field at all **never entered the
// corpus**, with the consequence: if the owner wanted to feed a note to the agent, they
// had to simultaneously make it public to the entire internet. The cost on the real
// vault -- none of the 223 wiki notes had `publish:` written at all, 173 leaves could
// never get in, leaving the corpus with only 50 folder nodes.
//
// Folder-notes (structural nodes) behave as before: built as tree nodes regardless of
// publish (otherwise child nodes would have no parent and paths would break).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('d');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync D · publish = visibility gate, not ingest gate', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── ingest: everything in the vault lands, regardless of publish ──
  test('publish:true leaf is imported and is publicly visible', publishTrue);
  test('publish:false leaf is STILL imported — it is gated, not absent', publishFalse);
  test('no publish key → still imported, gated by default', noPublishKey);
  // ── the gate itself ──
  test('publish only sets `published`; it never decides corpus membership', publishSetsOnlyVisibility);
  test('an unpublished folder-note still exists as a tree node for its child', structuralFolderNote);
  // ── tolerance ──
  test('tolerance: publish:"true" (string) is coerced to true', publishStringTrue);
  test('tolerance: publish written in body (not frontmatter) is not honored', publishInBody);
});

async function readOf(request: APIRequestContext, path: string) {
  const sess = await syncSession(request, OWNER);
  return syncRead(request, sess, path);
}

// noteOf —— the owner's own view of the row: proves corpus MEMBERSHIP + the `published` flag,
// independent of any visitor's ACL.
async function noteOf(request: APIRequestContext, title: string) {
  const list = await adminGenreList(request, OWNER, 'wiki');
  return list.find((n) => n.title === title);
}

async function publishTrue({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/kept.md', body: makeVaultMD({ publish: true }, 'k') }]);
  expect((await readOf(request, 'kept')).genre).toBe('wiki');
  expect((await noteOf(request, 'kept'))?.published, 'publish:true → anonymous-visible').toBe(true);
  await request.dispose();
}

// publishFalse —— the inversion that matters: an unpublished note is IN the corpus (the owner's
// code-holders and the agent reach it via role globs); it is merely not public.
async function publishFalse({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/draft.md', body: makeVaultMD({ publish: false }, 'd') }]);
  expect(await noteOf(request, 'draft'), 'publish:false is imported, not skipped').toBeTruthy();
  expect((await noteOf(request, 'draft'))?.published, 'but it is gated').toBe(false);
  expect((await readOf(request, 'draft')).body ?? '', 'a code-holder still reads it').toContain('d');
  await request.dispose();
}

// noPublishKey —— the shape of EVERY note in the owner's real vault: the key simply is not there.
// It must land and be groundable, gated by default.
async function noPublishKey({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/keyless.md', body: makeVaultMD({ tags: ['x'] }, 'k') }]);
  expect(await noteOf(request, 'keyless'), 'no publish key → still imported').toBeTruthy();
  expect((await noteOf(request, 'keyless'))?.published, 'gated by default').toBe(false);
  expect((await readOf(request, 'keyless')).genre, 'a code-holder still reads it').toBe('wiki');
  await request.dispose();
}

// publishSetsOnlyVisibility —— the two concerns side by side in one vault: both notes are corpus
// members; they differ ONLY in `published`. This is the invariant the old ingest-gate broke.
async function publishSetsOnlyVisibility({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/open.md', body: makeVaultMD({ publish: true }, 'open') },
    { rel: 'wiki/shut.md', body: makeVaultMD({ publish: false }, 'shut') },
  ]);
  const list = await adminGenreList(request, OWNER, 'wiki');
  expect(list.map((n) => n.title), 'BOTH are in the corpus — membership is not publish-gated')
    .toEqual(expect.arrayContaining(['open', 'shut']));
  expect(list.find((n) => n.title === 'open')?.published).toBe(true);
  expect(list.find((n) => n.title === 'shut')?.published).toBe(false);
  await request.dispose();
}

async function structuralFolderNote({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // folder-note math is publish:false; its child kepler is publish:true → kepler must still resolve.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/math/math.md', body: makeVaultMD({ publish: false, tags: ['node'] }, 'node index') },
    { rel: 'wiki/math/kepler.md', body: makeVaultMD({ publish: true }, 'kepler') },
  ]);
  expect((await readOf(request, 'math/kepler')).body ?? '', 'published child under unpublished node')
    .toContain('kepler');
  await request.dispose();
}

async function publishStringTrue({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/coerced.md', body: makeVaultMD({ publish: 'true' }, 'c') },
  ]);
  expect((await readOf(request, 'coerced')).genre, 'string "true" coerced').toBe('wiki');
  expect((await noteOf(request, 'coerced'))?.published, 'coerced → published').toBe(true);
  await request.dispose();
}

// publishInBody —— `publish: true` in the BODY is not frontmatter, so it must not publish. The note
// still lands (membership is unconditional); it is simply gated.
async function publishInBody({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/bodypub.md', body: makeVaultMD({ tags: ['x'] }, 'publish: true\nfake') },
  ]);
  expect(await noteOf(request, 'bodypub'), 'still imported').toBeTruthy();
  expect((await noteOf(request, 'bodypub'))?.published, 'body publish not honored → gated').toBe(false);
  await request.dispose();
}
