// render-tikz-fonts.spec.ts —— TikZ 图里的**字**要用 TeX 字体画出来,不是退回系统字体。
//
// node-tikzjax 输出的 SVG 里,文字是 `<text>` + `font-family: cmr10 / cmsy10 / …`,字符是
// **TeX 字体里的槽位**,不是 Unicode。`$\to$` 在 cmsy10 里落在 0x21 —— 也就是 `!`。所以
// 那套 BaKoMa 字体不加载的话,浏览器退回系统字体,一个箭头就当场变成一个惊叹号,而且
// 字距按错的度量排,词会被拆开(`stochastic` → `sto chastic`)。
//
// 这个包自己带 css/fonts.css + bakoma/ttf,而 `embedFontCss` 默认是 **false**,默认的
// `fontCssUrl` 还指着 jsDelivr 的 CDN —— 对一个自托管产品是错的:离线装不上,而且每张图
// 都要向第三方发一次请求。所以字体我们自己发。
//
// 既有的 render-tikz.spec 画的是一个三角形,**一个字都没有**,所以它结构上就看不见这件事。
// 这条也不去断 SVG 里那个字符 —— 无论好坏它都是 `!`,是**字体**让它长成箭头。断的是
// 浏览器真的去取了那个 TeX 字体并且取到了:那正是坏掉时唯一缺的东西。

import { resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { test, expect } from '@/fixtures/test';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('tikzfonts');

// 真 vault 里 optimization.md 那张图就是这个形状:一个 \node 里混着文字和 `$\to$`。
const TIKZ = [
  '```tikz',
  '\\begin{tikzpicture}',
  '\\draw (0,0) -- (6,0);',
  '\\node at (3,-1) {stochastic $\\to$ discrete $\\to$ learned-objective};',
  '\\end{tikzpicture}',
  '```',
].join('\n');

test.describe('render · TikZ text uses the TeX fonts, not a fallback', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('the font stylesheet and its faces are served by this instance', async ({ request }) => {
    const css = await request.get('/tikz-fonts/fonts.css');
    expect(css.status(), 'the instance serves the TikZ font stylesheet itself').toBe(200);
    // cmsy10 是数学符号那一支 —— `\to` 就住在里面。它不在,箭头就没救。
    expect(await css.text(), 'the math-symbol face is declared').toContain('cmsy10');

    const face = await request.get('/tikz-fonts/bakoma/ttf/cmsy10.ttf');
    expect(face.status(), 'a declared face is actually downloadable').toBe(200);
  });

  test('rendering a diagram with text makes the browser fetch a TeX face',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/tikz-text.md', body: makeVaultMD({ publish: true }, `## Diagram\n\n${TIKZ}`) },
      ]);

      // 先挂上等待再导航:字体请求发生在 SVG 注入的当刻,晚一步就错过了。
      const face = page.waitForResponse(
        (r) => r.url().includes('/tikz-fonts/') && r.url().endsWith('.ttf'),
        { timeout: 30_000 },
      );

      await goto(page, '/wiki/tikz-text');
      await expect(page.getByTestId('wiki-body')).toBeVisible();
      await expect(page.locator('[data-testid="tikz-svg"] svg')).toBeVisible({ timeout: 30_000 });

      // 这一条才是判据:浏览器真的去要了 TeX 字体。没有这次请求 = 图上的字在用退回字体画,
      // 而那正是箭头变成 `!` 的时刻。
      expect((await face).status(), 'the browser fetched a TeX face for the diagram text').toBe(200);
    });
});
