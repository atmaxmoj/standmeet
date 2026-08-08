// sync-publish-absent-keeps.spec.ts —— vault 没说 publish,不等于 vault 说 false。
//
// 真实环境上撞到的:`/wiki/optimization` 本来是公开页,也是首页唯一那张 pin 卡;一次 authoritative
// 同步之后变成 not found,首页那一段整块消失。而真 vault 里 `grep -rl '^publish:' wiki` 是
// **0 / 574** —— 一个 publish 键都没有。
//
// 也就是说 sync 把「缺键」当成了 `false`,覆盖掉一个只有 StandMeet 才拥有的字段。这是
// empty-is-not-json-null 的同一个形状:**缺席是一句没说的话,不是一句否定。**发布是 web 上做的
// 编辑,vault-sync check 8 要求它活过 re-sync。
//
// 契约:frontmatter **没有** publish 键 → 保持原状;**显式** `publish: false` → 下架。
// (export 那侧本来就会把 `publish: %t` 写回去,所以下一次往返就是显式的 —— 缺了就补上。)

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

// TITLE —— sync 的标题取自**文件名**,不是正文的 H1(见 sync-c-title)。
const TITLE = 'keeps-its-publish';
const REL = `wiki/${TITLE}.md`;
const BODY = '# Keeps its publish\n\nbody that stays the same across syncs';

// noPublishKey —— 一条**没有** publish 键的笔记,跟真 vault 的 574 条一样。
const noPublishKey = makeVaultMD({ tags: ['audit'] }, BODY);

test.describe('vault-sync · an absent publish key is silence, not a no', () => {
  test.beforeAll(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('a note published on the web survives a sync that never mentions publish',
    async ({ request }) => {
      // 先带 publish: true 同步一次 —— 相当于 owner 在网页上把它发布了。
      await uploadVault(request, OWNER, [
        { rel: REL, body: makeVaultMD({ publish: true, tags: ['audit'] }, BODY) },
      ], { authoritative: true });

      const before = await fetchPublished(request);
      expect(before, 'precondition: the entry is public').toBe(true);

      // 再同步一次,这一次 frontmatter 里**没有** publish 键(真 vault 就是这样)。
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

// fetchPublished —— 这条 wiki 现在是不是 published。断的是**落库的状态**,不是同步回参的计数。
// 用既有的 adminGenreList(sync-d-publish 也用它),不自己另造一个读法:自造的探针今天已经骗过
// 我两次,而「找不到行」跟「published:false」在一个 `?? false` 里长得一模一样。
async function fetchPublished(request: APIRequestContext): Promise<boolean> {
  const list = await adminGenreList(request, OWNER, 'wiki');
  const row = list.find((n) => n.title === TITLE);
  expect(row, 'the note must be in the corpus at all').toBeDefined();
  return row?.published ?? false;
}
