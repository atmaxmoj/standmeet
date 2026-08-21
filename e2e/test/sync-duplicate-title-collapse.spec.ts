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

  // F-L-60 —— **同名的两篇各自的链接**。
  //
  // 上面那条修的是 reconcile：basename 不唯一时改按 `source_path` 认领，两份文件各落各的行。
  // 但**链接那一半没跟上**：`obsidian/sync.go:284` 决定「这些链接挂到哪条笔记」时用的还是
  // `st.titleToID[node.title]` —— 一张按 title 索引的表，而 title 恰恰不唯一。同名的几篇
  // 共用一个桶，`RebuildForNote(id, body)` 又是**重建**，后处理的那篇把前一篇的边整个盖掉。
  // 又一次「一个能力两个面，只修了一个面」。
  //
  // prod 上量到的代价：同名笔记 97 条，只有 22 条有出边，**41 条正文里有 `[[` 却一条边都没有**
  // —— 而 vault 自己的 check-links.sh 说这些链接全是好的。损失只发生在我们这一侧，不报错。
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
    // 两条都要有**自己的**那条边。红态：其中一条是空的 —— 它的链接被同名兄弟的重建盖掉了。
    expect(wiki.outbound, 'wiki/Foo 保住自己的出边').toContain('wiki-target');
    expect(subj.outbound, 'subjectivity/Foo 保住自己的出边').toContain('subj-target');
    // 而且不许串门：桶如果是共用的，会看到对方的目标。
    expect(wiki.outbound, 'wiki/Foo 不该拿到兄弟的目标').not.toContain('subj-target');
    expect(subj.outbound, 'subjectivity/Foo 不该拿到兄弟的目标').not.toContain('wiki-target');
  });
});
