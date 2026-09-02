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
import { adminNoteRefs, claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

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

  // F-L-60 —— **two same-titled notes must each keep their own links**.
  //
  // The fix above addresses reconcile: when a basename isn't unique, claim by
  // `source_path` instead, so the two files land on their own separate rows. But **the
  // linking half didn't keep up**: `obsidian/sync.go:284` still decides "which note do
  // these links attach to" using `st.titleToID[node.title]` — a table indexed by title, and
  // title is exactly what's not unique. Notes sharing a title share one bucket, and
  // `RebuildForNote(id, body)` is a **rebuild**, so whichever note gets processed second
  // wholesale overwrites the previous one's edges. Once again: "one capability, two faces,
  // only one face got fixed".
  //
  // Cost measured in prod: 97 same-titled notes, only 22 have outbound edges — **41 have
  // `[[` in the body but not a single edge** — while the vault's own check-links.sh reports
  // all these links as fine. The loss only happens on our side, and it never raises an error.
  test('two same-basename notes keep their OWN outbound links (F-L-60)', async ({ request }) => {
    await uploadVault(request, OWNER, [
      { rel: 'wiki/wiki-target.md', body: makeVaultMD({ publish: true }, 'the wiki target.') },
      { rel: 'subjectivity/subj-target.md', body: makeVaultMD({ publish: true }, 'the subj target.') },
      { rel: 'wiki/Foo.md', body: makeVaultMD({ publish: true }, 'points at [[wiki-target]].') },
      {
        rel: 'subjectivity/Foo.md',
        body: makeVaultMD({ publish: true }, 'points at [[subj-target]].'),
      },
    ]);

    const wiki = await adminNoteRefs(request, OWNER, 'wiki', 'Foo');
    const subj = await adminNoteRefs(request, OWNER, 'subjectivity', 'Foo');
    // Both notes must have **their own** edge. RED state: one of them is empty — its links
    // got overwritten by the same-titled sibling's rebuild.
    expect(wiki.outbound, 'wiki/Foo 保住自己的出边').toContain('wiki-target');
    expect(subj.outbound, 'subjectivity/Foo 保住自己的出边').toContain('subj-target');
    // And they must not cross over: if the bucket is shared, one would see the other's target.
    expect(wiki.outbound, 'wiki/Foo 不该拿到兄弟的目标').not.toContain('subj-target');
    expect(subj.outbound, 'subjectivity/Foo 不该拿到兄弟的目标').not.toContain('wiki-target');
  });
});
