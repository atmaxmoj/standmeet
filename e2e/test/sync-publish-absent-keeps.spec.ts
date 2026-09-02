// sync-publish-absent-keeps.spec.ts -- the vault saying nothing about publish is not
// the same as the vault saying false.
//
// Hit in a real environment: `/wiki/optimization` used to be a public page, and the
// homepage's one and only pin card; after one authoritative sync it became not found,
// and that whole section of the homepage vanished. And in the real vault,
// `grep -rl '^publish:' wiki` returns **0 / 574** -- not one note carries a publish key.
//
// In other words, sync was treating "the key is missing" as `false`, overwriting a
// field only StandMeet owns. This is the same shape as empty-is-not-json-null:
// **absence is a sentence never spoken, not a negation.** Publishing is an edit made
// on the web, and vault-sync check 8 requires it to survive a re-sync.
//
// Contract: frontmatter **without** a publish key -> leave it alone; an **explicit**
// `publish: false` -> unpublish it. (The export side already writes `publish: %t` back
// out, so the very next round trip becomes explicit -- whatever's missing gets filled in.)

import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { test, expect } from '@/fixtures/test';
import { adminGenreList } from '@/fixtures/vault-sync';

const OWNER = {
  email: 'pubkeep@example.com', password: 'correct-horse-battery-staple',
  handle: 'pubkeep', fullName: 'Publish Keep Owner',
};

// TITLE -- sync takes its title from **the filename**, not the body's H1 (see sync-c-title).
const TITLE = 'keeps-its-publish';
const REL = `wiki/${TITLE}.md`;
const BODY = '# Keeps its publish\n\nbody that stays the same across syncs';

// noPublishKey -- a note **without** a publish key, matching all 574 notes in the real
// vault.
const noPublishKey = makeVaultMD({ tags: ['audit'] }, BODY);

test.describe('vault-sync · an absent publish key is silence, not a no', () => {
  test.beforeAll(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('a note published on the web survives a sync that never mentions publish',
    async ({ request }) => {
      // Sync once first with publish: true -- equivalent to the owner publishing it on
      // the web.
      await uploadVault(request, OWNER, [
        { rel: REL, body: makeVaultMD({ publish: true, tags: ['audit'] }, BODY) },
      ], { authoritative: true });

      const before = await fetchPublished(request);
      expect(before, 'precondition: the entry is public').toBe(true);

      // Sync again, this time with **no** publish key in the frontmatter (exactly how
      // the real vault looks).
      await uploadVault(request, OWNER, [{ rel: REL, body: noPublishKey }], { authoritative: true });

      expect(
        await fetchPublished(request),
        'silence in the vault must not retract a page the owner published',
      ).toBe(true);
    });

  test('an explicit publish: false does unpublish it', async ({ request }) => {
    await uploadVault(request, OWNER, [
      { rel: REL, body: makeVaultMD({ publish: false, tags: ['audit'] }, BODY) },
    ], { authoritative: true });

    expect(
      await fetchPublished(request),
      'an explicit false is a statement, and it must be honoured',
    ).toBe(false);
  });
});

// fetchPublished -- whether this wiki entry is published right now. Asserts on
// **the state stored in the DB**, not on the sync response's counters. Reuses the
// existing adminGenreList (also used by sync-d-publish) rather than rolling a bespoke
// reader: a homemade probe has already fooled me twice, and "row not found" looks
// identical to "published:false" once both fall through the same `?? false`.
async function fetchPublished(request: APIRequestContext): Promise<boolean> {
  const list = await adminGenreList(request, OWNER, 'wiki');
  const row = list.find((n) => n.title === TITLE);
  expect(row, 'the note must be in the corpus at all').toBeDefined();
  return row?.published ?? false;
}
