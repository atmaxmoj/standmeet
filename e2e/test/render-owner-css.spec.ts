// render-owner-css.spec.ts —— owner custom CSS actually renders (not just backend store/read).
//
// Owner saves a CSS snippet from admin (backend sanitizes + scopes it to
// .corpus-content) → on the published wiki reader page: (a) <head> has a
// <link> to /api/v1/appearance.css; (b) elements inside .corpus-content show
// the owner rule in their computed style; (c) unset → no effect; (d) scope
// safety: the rule cannot touch app chrome.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { adminSetCSS } from '@/fixtures/presentation';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('rendercss');

test.describe('render · owner custom CSS actually applies on the reader', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('scoped owner rule restyles the note body + a <link> to appearance.css is present',
    async ({ request, page }) => {
      // Owner writes a bare `h2{…}`; the backend scopes it to `.corpus-content h2`.
      const status = await adminSetCSS(request, OWNER, 'h2 { color: rgb(181, 57, 28); }');
      expect(status).toBe(200);
      await uploadVault(request, OWNER, [
        { rel: 'wiki/styled.md', body: makeVaultMD({ publish: true }, '## Section Heading\n\nBody.') },
      ]);

      await goto(page, '/wiki/styled');
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible();
      // (a) the stylesheet resource is <link>ed.
      await expect(page.locator('link[href="/api/v1/appearance.css"]')).toHaveCount(1);
      // (b) .corpus-content scope anchor present + the owner rule applies to h2.
      await expect(body.locator('.corpus-content')).toHaveCount(1);
      await expect(body.locator('h2')).toHaveCSS('color', 'rgb(181, 57, 28)');
    });

  test('no owner CSS → h2 keeps the default (not the owner accent)',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/plain.md', body: makeVaultMD({ publish: true }, '## Plain Heading\n\nBody.') },
      ]);
      await goto(page, '/wiki/plain');
      const h2 = page.getByTestId('wiki-body').locator('h2');
      await expect(h2).toBeVisible();
      const color = await h2.evaluate((el) => getComputedStyle(el).color);
      expect(color).not.toBe('rgb(181, 57, 28)');
    });

  test('scope safety: an owner rule targeting app chrome cannot restyle outside .corpus-content',
    async ({ request, page }) => {
      // owner tries to nuke the top nav; scoping turns it into `.corpus-content nav`, so the
      // real chrome nav (outside .corpus-content) is untouched.
      const status = await adminSetCSS(request, OWNER, 'nav { display: none; }');
      expect(status).toBe(200);
      await uploadVault(request, OWNER, [
        { rel: 'wiki/scoped.md', body: makeVaultMD({ publish: true }, '## Scoped\n\nBody.') },
      ]);
      await goto(page, '/wiki/scoped');
      // the wiki top bar (a nav outside the note body) is still visible.
      await expect(page.getByTestId('wiki-body')).toBeVisible();
      const navHidden = await page.locator('nav').first().evaluate(
        (el) => getComputedStyle(el).display === 'none',
      ).catch(() => false);
      expect(navHidden).toBe(false);
    });

  // The owner's snippet is written in **Obsidian's variable dialect** — something
  // already linted in their vault. The site accepts it, sanitizes it, adds a
  // scope prefix, yet defines none of those variables → the rule "takes effect"
  // while **changing nothing** (F-L-36: in the real vault, `[!definition]`
  // (green) and `[!theorem]` (blue) both rendered as the same pale red). These
  // two cases guard exactly that contract: **whatever the owner wrote, the page must show.**
  test('owner 的 callout 颜色（Obsidian 的 --callout-color 三元组）真的上到 callout 上',
    async ({ request, page }) => {
      const status = await adminSetCSS(
        request, OWNER,
        '.callout[data-callout="theorem"] { --callout-color: 79, 140, 230; }',
      );
      expect(status).toBe(200);
      await seedCalloutNote(request, 'theorem-note', 'theorem', 'T1');

      await goto(page, '/wiki/theorem-note');
      const callout = page.getByTestId('wiki-body').locator('.callout[data-callout="theorem"]');
      await expect(callout).toBeVisible({ timeout: 8_000 });
      // The left-hand vertical bar IS the coloring mechanism — if the owner says blue, it must be blue, not the site's vermillion.
      await expect(callout).toHaveCSS('border-left-color', 'rgb(79, 140, 230)');
    });

  test('没写 snippet 的 callout 保持站点自己的 accent（默认值没被改坏）',
    async ({ request, page }) => {
      await seedCalloutNote(request, 'plain-callout', 'note', 'N1');
      await goto(page, '/wiki/plain-callout');
      const callout = page.getByTestId('wiki-body').locator('.callout[data-callout="note"]');
      await expect(callout).toBeVisible({ timeout: 8_000 });
      await expect(callout).toHaveCSS('border-left-color', 'rgb(181, 57, 28)');
    });
});

// seedCalloutNote —— a published note whose body is a single callout.
async function seedCalloutNote(
  request: APIRequestContext, slug: string, kind: string, title: string,
): Promise<void> {
  await uploadVault(request, OWNER, [
    {
      rel: `wiki/${slug}.md`,
      body: makeVaultMD({ publish: true }, `> [!${kind}] ${title}\n> body.\n`),
    },
  ]);
}
