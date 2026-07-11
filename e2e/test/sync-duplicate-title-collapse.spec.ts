// sync-duplicate-title-collapse.spec.ts —— RED repro (bug hunt #9). The Obsidian reconcile claims
// notes BY TITLE across all genres: reconcileNode → Notes.GetByTitle → GetNoteByTitleAnyGenre
// (`WHERE owner_id=$1 AND title=$2 ORDER BY created_at ASC LIMIT 1` — oldest note of ANY genre).
// The design comment assumes "basename 全 vault 唯一", but nothing enforces it. Two vault files
// that share a basename in different folders/genres therefore COLLAPSE: the second file's sync
// finds the first note (oldest) and updateNode overwrites it with the second's genre+body — one
// note survives with mangled genre, the other file's content is silently lost. There is no
// (owner_id,title) uniqueness, no error, no dedup — silent data corruption.
//
// The reconcile claims notes BY TITLE and assumes basenames are unique across the vault. When two
// files share a basename it must NOT silently collapse them (title-based claim can't tell "same
// note moved genre" from "two distinct notes" — either overwrites content or spawns re-sync
// duplicates). Boundary: surface the ambiguous collision as a clear per-file error and leave the
// existing note untouched. GREEN = reported; currently RED — errors:[] (created:1, updated:1,
// silently collapsed onto one note).

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('duptitle');

test.describe('sync · duplicate note titles must not silently collapse (bug hunt #9)', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('two same-title files are reported as a collision, not silently collapsed', async ({
    request,
  }) => {
    const result = await uploadVault(request, OWNER, [
      { rel: 'wiki/Foo.md', body: makeVaultMD({ publish: true }, 'WIKI body content.') },
      { rel: 'subjectivity/Foo.md', body: makeVaultMD({ publish: true }, 'SUBJ body content.') },
    ]);
    expect(result.errors.length, 'the duplicate-title collision must be surfaced, not swallowed')
      .toBeGreaterThan(0);
    expect(result.errors.join(' '), 'the error names the colliding title').toMatch(/Foo/i);
    // and it must NOT have quietly overwritten one note with the other (the silent-collapse signature
    // was created:1 + updated:1 with no error).
    expect(result.updated, 'no silent cross-genre overwrite').toBe(0);
  });
});
