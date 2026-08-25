// vault-roundtrip-fidelity.spec.ts —— **往返是恒等变换**：传上去、导下来、中间什么都没做，
// vault 里的每个文件必须逐字节回到原样。
//
// 为什么要合成的这一份，而真 vault 那条（`vault-roundtrip-noop.spec.ts`）还不够：
// 那一条要 owner 的 `~/Develop/writing/notes` 在场，别的机器上它 **skip** —— 而一条跳过的用例
// 跟一条通过的用例在报告里长得一样。所以缺陷的形状要在**合成的、永远会跑的**夹具上各钉一条。
//
// 这里的三条各钉一个已被真 vault 量出来的缺陷（数字见 F-L-66/67/68）：
//
//   ① raw 每往返一次就在顶上叠一块 frontmatter —— **无上限**。483 篇 raw 中招。
//      导入侧 raw 是 fm-exempt（整个文件都是 body，连 `---` 也是），导出侧不分 genre
//      一律先写一块 `---publish---`。两个各自合理的决定合成一个环。
//      代价不只是文件变长：第一轮之后 `tags`/`status` 不再是 frontmatter，Obsidian 的
//      属性和标签图谱当场失效。
//
//   ② 产品自己存着的字段，导出不写。`excerpt` / `css_classes` / `lang_labels` 三个列都在
//      库里，`ListAllForExport` 根本没读。跟 F-L-59（当年 lang/aliases 那次）同一个形状 ——
//      那次修了两个字段，没扫到邻居。
//      还有一半：**产品不认识的键被静默丢弃**。真 vault 上 `langs` 596 篇、`aliases-zh` 595 篇、
//      `owns` 33 篇（其中 wiki 32）—— 这些不是边角，是大多数。
//
//   ③ 只有自己一个孩子的 folder-note 被搬家：`x/y/y.md` → `x/y.md`。22 篇。
//      笔记内容没变，但**镜像不该替 owner 改文件布局**。
//
// 判据一律是**逐字节相等**，不是「正文还在」。既有的 `sync-j-export.spec.ts` 里那条 roundtrip
// 自己声明了不断字节相等（"Byte-equality is the wrong bar — frontmatter is reconstructed"），
// 于是「往返把文件重写了、而且越写越长」这件事它结构上判不出来。

import * as fflate from 'fflate';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { uploadVault, downloadExport, type VaultFile } from '@/fixtures/obsidian';

const OWNER = {
  email: 'vault-fidelity@example.com', password: 'correct-horse-battery-staple',
  handle: 'vaultfidelity', fullName: 'Vault Fidelity Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// 不用 serial：三条各自 authoritative 上传（整库替换），本来就独立。串起来的话第一条一红
// 后两条直接跳过 —— 而我要的是**三个缺陷各自的红**，不是第一个红把另外两个盖住。
test.describe('vault mirror · a round trip is the identity', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // ① —— 这一条是唯一一个**不收敛**的：每轮再叠一块，所以它测两轮。
  test('a raw note keeps its own frontmatter instead of gaining one every round',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      const vault: VaultFile[] = [{
        rel: 'raw/thinking/thinking.md',
        body: '---\ntags: [fact, thinking]\nstatus: seed\n---\n\n# Thinking\n\nhalf-formed.\n',
      }, {
        rel: 'raw/thinking/a-child.md',
        body: '---\nstatus: seed\n---\n\nkeeps the parent a folder.\n',
      }];

      const first = await roundTrip(request, vault);
      expect(first, 'round 1 returns the raw note byte-for-byte').toEqual(asMap(vault));

      // **两轮**：① 的病灶是叠加，一轮只看得见「多了一块」，两轮才看得见「每轮都多一块」。
      const second = await roundTrip(request, toVault(first));
      expect(second, 'round 2 is a fixed point — nothing accumulates').toEqual(asMap(vault));

      await request.dispose();
    });

  // ② —— 产品存着的字段 + 产品不认识的键，两半都必须回来。
  test('every frontmatter key comes back — the ones we store and the ones we do not understand',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      // 键的选取照着真 vault 的用法：内联数组、连字符键、多语言那一组。
      const vault: VaultFile[] = [{
        rel: 'wiki/berlyne.md',
        body: [
          '---',
          'tags: [fact, cognitive-science]',      // 已知，且是**内联数组**形态
          'aliases-zh: [Berlyne 唤醒曲线]',        // 不认识 —— 真 vault 上 595 篇
          'aliases: [Berlyne 唤醒曲线]',
          'langs: [en, zh]',                      // 不认识 —— 真 vault 上 596 篇
          'lang: en',
          'owns: [arousal]',                      // 不认识 —— 真 vault 上 32 篇 wiki
          'cssclasses: [wide]',                   // **存了**（css_classes 列）却不导出
          'excerpt: an inverted-U',               // **存了**（excerpt 列）却不导出
          '---',
          '',
          '# Berlyne',
          '',
          'arousal and preference.',
          '',
        ].join('\n'),
      }];

      const back = await roundTrip(request, vault);
      expect(back, 'a wiki note keeps every frontmatter key, in its own formatting')
        .toEqual(asMap(vault));

      await request.dispose();
    });

  // ③ —— 布局不许被改写。
  test('a folder note that is alone in its folder stays in its folder',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      // owner 的约定是「笔记放在同名文件夹里」，哪怕那个文件夹里只有它自己。
      // 真 vault 上 22 篇是这个形状（raw/linguistics/linguistics.md 等）。
      const vault: VaultFile[] = [{
        rel: 'raw/linguistics/linguistics.md',
        body: '---\nstatus: seed\n---\n\n# Linguistics\n\nalone in its folder.\n',
      }];

      const back = await roundTrip(request, vault);
      expect(Object.keys(back).sort(), 'the mirror does not restructure the vault')
        .toEqual(['raw/linguistics/linguistics.md']);

      await request.dispose();
    });
});

// ─── 驱动 ────────────────────────────────────────────────────────────────────────────────

// roundTrip —— 传上去，导下来。导出的 zip 键就是 vault 内相对路径，两边直接按键比。
async function roundTrip(
  request: APIRequestContext, files: VaultFile[],
): Promise<Record<string, string>> {
  await uploadVault(request, OWNER, files, { authoritative: true });
  const zip = fflate.unzipSync(new Uint8Array(await downloadExport(request, OWNER)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (!k.endsWith('/')) out[k] = new TextDecoder().decode(v);
  }
  return out;
}

function asMap(files: VaultFile[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f.rel, f.body]));
}

function toVault(m: Record<string, string>): VaultFile[] {
  return Object.entries(m).map(([rel, body]) => ({ rel, body }));
}
