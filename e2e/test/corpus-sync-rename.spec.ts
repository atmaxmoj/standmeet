// corpus-sync-rename.spec.ts -- pre-migration gap-fill (🟡#3).
//
// **Moving/renaming** a note inside the vault (source_path changes, frontmatter slug stays
// stable) and re-importing -- previously **zero test coverage** (obsidian-sync only tested
// the update branch of re-importing at the same path). Reality (import.go:12): idempotency
// is **source_path OR slug** (not "source_path only" as todo #24 claims -- that note is
// stale). So a rename with a stable slug -> matches the original note by **slug** ->
// **updates** it (source_path refreshed to the new one), no orphan, no duplicate. A
// structural migration to unify sync identity across genres / possibly add a "stable
// identity key" is planned -- this test pins down the current slug-based matching behavior,
// so any change from that migration must be **deliberate**.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { listAdminWritings, makeVaultMD, uploadVault } from '@/fixtures/obsidian';

const OWNER = {
  email: 'syncrename@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'syncrename',
  fullName: 'Sync Rename Owner',
};
const SLUG = 'stable-note';

test.describe('obsidian sync: moving a note (new source_path, stable slug) updates by slug, not orphans',
  () => {
    test.beforeAll(async ({ playwright }) => {
      resetInstance();
      const request = await playwright.request.newContext();
      await claim(request, findSetupToken(), {
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, fullName: OWNER.fullName,
      });
      await request.dispose();
    });

    test('re-importing the same note at a new path → matched by slug → updated, single row',
      async ({ playwright }) => {
        const request = await playwright.request.newContext();
        const md = (body: string): string =>
          makeVaultMD({ title: 'Stable Note', slug: SLUG, publish: true }, body);

        // 1) initial import at notes/.
        const first = await uploadVault(request, OWNER, [
          { rel: 'writing/stable-note.md', body: md('original body') },
        ]);
        expect(first.created, 'first import creates the note').toBe(1);

        // 2) the note is MOVED in the vault (new source_path) but keeps its frontmatter slug.
        const moved = await uploadVault(request, OWNER, [
          { rel: 'writing/archive/stable-note.md', body: md('body after the move') },
        ]);
        expect(moved.created, 'a moved note is not created afresh').toBe(0);
        expect(moved.updated, 'a moved note is matched by slug and updated').toBe(1);
        expect(moved.errors, 'no slug-collision error').toEqual([]);

        // 3) exactly one writing survives — no orphan/duplicate.
        const writings = await listAdminWritings(request, OWNER);
        const matches = writings.filter((w) => w.slug === SLUG);
        expect(matches.length, 'a single writing for the slug (moved, not duplicated)').toBe(1);
        expect(matches[0]!.body_md, 'the surviving row has the post-move body')
          .toContain('body after the move');
        await request.dispose();
      });
  });
