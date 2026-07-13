// sync-duplicate-title-collapse.spec.ts —— F-L-2. Two vault files that SHARE a basename in
// different folders (e.g. wiki/Foo.md + subjectivity/Foo.md) are TWO DISTINCT files — Obsidian
// allows same-basename-different-folder, and a real vault leans on it heavily (bug-hunt #9's
// "reject the collision" resolution dropped ~46% of a real vault + shattered its tree).
//
// The reconcile used to claim BY TITLE (GetNoteByTitleAnyGenre) and, finding basenames non-unique,
// REJECTED the second file — data loss disguised as a guard. The fix restores the schema's intended
// identity (obsidian_source_path, unique per file): when a basename is not unique in the vault, the
// reconcile claims by source_path so each distinct file lands in its own row. A genuine genre-MOVE
// is one file across syncs (not a same-snapshot duplicate) so it stays title-claimed and moves in
// place. GREEN = both files import with no error; RED (pre-fix) = created:1 + a collision error.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('duptitle');

test.describe('sync · same-basename files in different folders both import (F-L-2)', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('two same-basename files (different folders) both import, not rejected', async ({
    request,
  }) => {
    const result = await uploadVault(request, OWNER, [
      { rel: 'wiki/Foo.md', body: makeVaultMD({ publish: true }, 'WIKI body content.') },
      { rel: 'subjectivity/Foo.md', body: makeVaultMD({ publish: true }, 'SUBJ body content.') },
    ]);
    // Same basename in different folders is legal (Obsidian) — no collision error, no drop.
    expect(result.errors, 'same-basename in different folders must not error').toEqual([]);
    expect(result.created, 'both distinct files land (claimed by source_path)')
      .toBeGreaterThanOrEqual(2);
    // A re-sync of the identical vault must be idempotent (claim the same rows, create nothing new).
    const again = await uploadVault(request, OWNER, [
      { rel: 'wiki/Foo.md', body: makeVaultMD({ publish: true }, 'WIKI body content.') },
      { rel: 'subjectivity/Foo.md', body: makeVaultMD({ publish: true }, 'SUBJ body content.') },
    ]);
    expect(again.errors, 're-sync clean').toEqual([]);
    expect(again.created, 're-sync creates nothing new (source_path claim is idempotent)').toBe(0);
  });
});
