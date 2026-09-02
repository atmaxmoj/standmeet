// render-tikz-fonts.spec.ts -- the **text** in a TikZ diagram must be drawn
// with TeX fonts, not fall back to system fonts.
//
// In the SVG node-tikzjax outputs, text is `<text>` + `font-family: cmr10 /
// cmsy10 / …`, and the characters are **slots inside a TeX font**, not
// Unicode. `$\to$` lands at 0x21 in cmsy10 -- which is `!`. So if that BaKoMa
// font set fails to load, the browser falls back to a system font, an arrow
// instantly becomes an exclamation mark, and letter spacing is laid out with
// the wrong metrics, splitting words apart (`stochastic` -> `sto chastic`).
//
// This package ships its own css/fonts.css + bakoma/ttf, but `embedFontCss`
// defaults to **false**, and the default `fontCssUrl` still points at
// jsDelivr's CDN -- wrong for a self-hosted product: it can't be installed
// offline, and every diagram would make a request to a third party. So we
// serve the fonts ourselves.
//
// The existing render-tikz.spec draws a triangle, with **not a single
// character of text**, so structurally it cannot see this problem. This spec
// also doesn't assert on the character inside the SVG -- broken or not, it's
// always `!`; it's the **font** that makes it look like an arrow. What it
// asserts is that the browser actually requested that TeX font and actually
// got it: that's exactly the one thing missing when this is broken.

import { resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { test, expect } from '@/fixtures/test';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('tikzfonts');

// The diagram in optimization.md in the real vault has exactly this shape:
// one \node mixing text with `$\to$`.
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
    // cmsy10 is the math-symbol face -- `\to` lives inside it. Without it,
    // the arrow is unrecoverable.
    expect(await css.text(), 'the math-symbol face is declared').toContain('cmsy10');

    const face = await request.get('/tikz-fonts/bakoma/ttf/cmsy10.ttf');
    expect(face.status(), 'a declared face is actually downloadable').toBe(200);
  });

  test('rendering a diagram with text makes the browser fetch a TeX face',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/tikz-text.md', body: makeVaultMD({ publish: true }, `## Diagram\n\n${TIKZ}`) },
      ]);

      // Arm the wait before navigating: the font request happens at the
      // moment the SVG is injected, and being a step late would miss it.
      const face = page.waitForResponse(
        (r) => r.url().includes('/tikz-fonts/') && r.url().endsWith('.ttf'),
        { timeout: 30_000 },
      );

      await goto(page, '/wiki/tikz-text');
      await expect(page.getByTestId('wiki-body')).toBeVisible();
      await expect(page.locator('[data-testid="tikz-svg"] svg')).toBeVisible({ timeout: 30_000 });

      // This is the actual judgment criterion: the browser really requested
      // the TeX font. No request = the diagram's text is drawn with the
      // fallback font, and that's exactly the moment the arrow becomes `!`.
      expect((await face).status(), 'the browser fetched a TeX face for the diagram text').toBe(200);
    });
});
