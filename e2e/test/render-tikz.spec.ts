// render-tikz.spec.ts —— TikZ 精确数学图渲染(RED-first,待实现)。
//
// 设计(rendering-and-extensibility.md §37):不 import Obsidian 插件,直接用底层库
// (TikZJax,跟 Obsidian 同引擎 → 两侧一致);WASM payload 大,须 **lazy**(不进 SSR),
// 跟 MermaidBlock 同 pattern。
//
// 契约:` ```tikz ` fenced block → 客户端 lazy 渲成 `<svg>`(TikZJax 输出),或渲染失败时
// 优雅 fallback(不崩、不把源码当普通 code 一直卡在 loading)。
//
// ⚠️ RED until TikZBlock 实现 + tikzjax 依赖引入。

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
});
