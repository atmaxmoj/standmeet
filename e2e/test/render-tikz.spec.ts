// render-tikz.spec.ts — precise TikZ math diagram rendering (RED-first, not yet
// implemented).
//
// Design (rendering-and-extensibility.md §37): don't import the Obsidian plugin, use
// the underlying library directly (TikZJax, the same engine Obsidian uses → the two
// sides stay consistent); the WASM payload is large, so it must be **lazy** (kept out
// of SSR), the same pattern as MermaidBlock.
//
// Contract: a ` ```tikz ` fenced block → the client lazily renders it to `<svg>`
// (TikZJax's output), or falls back gracefully on a render failure (no crash, and
// never leaves the source stuck in a loading state as if it were plain code).

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

  // In a real vault, tikz **almost never sits at the top level**: a multi-language
  // note wraps its body in a double-nested `> [!i18n]` blockquote, and the diagram
  // rides along inside it. The case above only drives the top-level cell — while in
  // prod, the PDA diagram at
  // `math/logic/chomsky-hierarchy/context-free-languages` rendered as **a whole
  // block of raw LaTeX source**, never even reaching a loading / error state, which
  // means that block was never recognized as tikz at all.
  // The coverage lands on the side of this rule where it can't quietly stop firing
  // (the same shape as Chinese-text emphasis, and as blockquote hrefs).
  test('引用块里的 ```tikz 一样渲成图，不是一段源码',
    async ({ request, page }) => {
      // `> >` double-nesting — matches the shape of an i18n callout in the vault.
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
      // The failure-detecting half: with the assertion above pinning down that the
      // image is really there, this one is no longer vacuously true on an empty page.
      await expect(doc, '不许把 LaTeX 源码印给读者').not.toContainText('\\begin{tikzpicture}');
    });

  // Multiple diagrams on one page — the normal case in a real vault
  // (`chomsky-hierarchy/context-free-languages` has 4). The two cases above each
  // have only one diagram, and **this defect never shows up with just one**: the
  // browser fires several `POST /render-tikz` requests at once, the server's WASM
  // TeX engine is not reentrant, and a collision makes both requests throw `TeX
  // engine render failed` (measured live: a single request returns 200, two
  // concurrent ones both come back 422 in 0.6s, without even reaching a timeout).
  // What the reader sees is "some diagrams rendered, some show a block of raw
  // LaTeX source", and which ones fail is random — this is exactly the case the
  // owner reported.
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
