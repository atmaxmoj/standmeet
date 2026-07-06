// corpus-sync-rename.spec.ts —— 迁移前 gap-fill (🟡#3)。
//
// 在 vault 里**移动/改名**一个笔记(source_path 变、frontmatter slug 稳定)再重导 —— 此前**零测试**
// (obsidian-sync 只测了同 path 重导的 update 分支)。而现实(import.go:12)：idempotency 是
// **source_path OR slug**(不是 todo #24 说的 "source_path only" —— 那条 stale)。所以带稳定 slug 的
// rename → 按 **slug** 匹配上原笔记 → **更新**(source_path 刷成新的)，不孤儿、不重复。结构迁移要统一
// 各 genre 的 sync identity / 可能加「稳定 identity key」—— 这条钉住当前的 slug-based 匹配行为，
// migration 的任何改动必须是**故意**的。

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
          { rel: 'notes/stable-note.md', body: md('original body') },
        ]);
        expect(first.created, 'first import creates the note').toBe(1);

        // 2) the note is MOVED in the vault (new source_path) but keeps its frontmatter slug.
        const moved = await uploadVault(request, OWNER, [
          { rel: 'archive/stable-note.md', body: md('body after the move') },
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
