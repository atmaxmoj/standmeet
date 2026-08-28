// render-tikz.spec.ts —— TikZ 精确数学图渲染(RED-first,待实现)。
//
// 设计(rendering-and-extensibility.md §37):不 import Obsidian 插件,直接用底层库
// (TikZJax,跟 Obsidian 同引擎 → 两侧一致);WASM payload 大,须 **lazy**(不进 SSR),
// 跟 MermaidBlock 同 pattern。
//
// 契约:` ```tikz ` fenced block → 客户端 lazy 渲成 `<svg>`(TikZJax 输出),或渲染失败时
// 优雅 fallback(不崩、不把源码当普通 code 一直卡在 loading)。

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('rendertikz');

const TIKZ = [
  '```tikz',
  '\\begin{tikzpicture}',
  '\\draw (0,0) -- (2,0) -- (1,1.5) -- cycle;',
  '\\end{tikzpicture}',
  '```',
].join('\n');

test.describe('render · TikZ diagrams on the reader', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a ```tikz block lazily renders to an <svg>',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/tikz.md', body: makeVaultMD({ publish: true }, `## Diagram\n\n${TIKZ}`) },
      ]);
      await goto(page, '/wiki/tikz');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      // the tikz block becomes an SVG (TikZJax output), not a stuck code block.
      await expect(doc.locator('[data-testid="tikz-svg"] svg')).toBeVisible({ timeout: 20_000 });
    });

  // 真 vault 里的 tikz **几乎不在顶层**：多语笔记把正文包在 `> [!i18n]` 的双层引用块里，
  // 图跟着进去。上面那条只驱了顶层那一格 —— 而 prod 上
  // `math/logic/chomsky-hierarchy/context-free-languages` 那张 PDA 图渲出来是**一整段
  // LaTeX 源码**，连 loading / error 态都没进，也就是说那个块根本没被认成 tikz。
  // 覆盖落在了这条规则不会失效的那一侧（跟中文强调、跟引用 href 是同一个形状）。
  test('引用块里的 ```tikz 一样渲成图，不是一段源码',
    async ({ request, page }) => {
      // `> >` 双层 —— 跟 vault 里 i18n callout 的形状一致。
      const quoted = ['> [!i18n]', '> > ## Diagram', '> >',
        ...TIKZ.split('\n').map((l) => `> > ${l}`)].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/tikz-quoted.md', body: makeVaultMD({ publish: true }, quoted) },
      ]);
      await goto(page, '/wiki/tikz-quoted');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      await expect(doc.locator('[data-testid="tikz-svg"] svg'),
        '引用块里的 tikz 也要变成图').toBeVisible({ timeout: 20_000 });
      // 判负的那一半：先钉住上面那条（图真的在），这一条才不是在空页上恒真。
      await expect(doc, '不许把 LaTeX 源码印给读者').not.toContainText('\\begin{tikzpicture}');
    });

  // 一页多张图 —— 真 vault 里的常态(`chomsky-hierarchy/context-free-languages` 有 4 张)。
  // 上面两条各只有一张图,而**一张图的时候这条缺陷不出现**:浏览器同时发几个
  // `POST /render-tikz`,服务端那个 WASM TeX 引擎不可重入,一撞就双方一起抛
  // `TeX engine render failed`(线上实测:单发 200,并发 2 个 → 两个都 422,0.6s 就回,
  // 连超时都没到)。读者看到的是「有的渲出来了,有的印着一段 LaTeX 源码」,而且哪几张
  // 失败是随机的 —— 这也正是 owner 报的那一条。
  test('同一页上的多张 tikz 全都渲出来,不是随机丢几张',
    async ({ request, page }) => {
      const three = [1, 2, 3]
        .map((n) => TIKZ.replace('(2,0)', `(${n + 1},0)`))
        .join('\n\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/tikz-many.md', body: makeVaultMD({ publish: true }, `## Three\n\n${three}`) },
      ]);
      await goto(page, '/wiki/tikz-many');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      await expect(doc.locator('[data-testid="tikz-svg"] svg').nth(2))
        .toBeVisible({ timeout: 60_000 });
      await expect(doc.locator('[data-testid="tikz-svg"] svg'), '三张全在')
        .toHaveCount(3, { timeout: 60_000 });
    });
});
