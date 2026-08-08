// sync-large-vault.spec.ts —— 一个真实规模的 vault 必须导得进来。
//
// 真 vault(574 wiki + 435 raw)过完客户端过滤是 1033 个文件,而导入在 **1001 个 part** 上直接
// 400。实测边界:999 个 part 成功并干了真活,1001 个 part 报
// `parse multipart: multipart: message too large`。
//
// 卡住的不是产品声明的那个上限 —— `maxObsidianImportSize` 是 **200MB**,而负载只有 6.2MB。
// 卡住的是 Go `mime/multipart.ReadForm` 缓冲整个表单时的 **1000 part** 默认上限,一个没人声明过
// 的数字。超一个文件,整次导入全废。
//
// 既有的 sync-* 用例都喂几十个合成文件,规模这一维从来没被断言过 —— item vault-sync check 1 的
// mock gap 写的就是这句「Hundreds of notes … nothing dropped 从未在规模上断言」。
//
// 这条只断一件事:**份数不该是导入的天花板**。

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'bigvault@example.com', password: 'correct-horse-battery-staple',
  handle: 'bigvault', fullName: 'Big Vault Owner',
};

// 1200 —— 稳稳越过 1000 那道墙,又不至于让用例变成压测。真 vault 是 1033。
const NOTES = 1200;

test.describe('vault-sync · a real-sized vault imports', () => {
  test.beforeAll(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('a vault of more than a thousand notes imports without a part-count wall',
    async ({ request }) => {
      const files = Array.from({ length: NOTES }, (_, i) => ({
        rel: `wiki/scale/note-${String(i).padStart(4, '0')}.md`,
        body: makeVaultMD({ publish: false }, `# Note ${i}\n\nbody ${i}`),
      }));

      const res = await uploadVault(request, OWNER, files, { authoritative: true });

      // 至少全部落地 ——「没报错」不算,少一条就是 dropped。用 >= 是因为中间文件夹会多出
      // 一个占位节点(`wiki/scale/` 自己),那是 check 3 要的行为,不该被写死的等号顶掉。
      expect(
        res.created + res.updated,
        `all ${NOTES} notes must land; a part count must not be the ceiling`,
      ).toBeGreaterThanOrEqual(NOTES);
      expect(res.errors, 'no note may fail to sync').toHaveLength(0);
    });
});
