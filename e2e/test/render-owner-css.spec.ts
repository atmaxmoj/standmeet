// render-owner-css.spec.ts —— owner 自定义 CSS 真渲染(不是只后端存/读)。
//
// owner 从 admin 存一段 CSS(后端 sanitize + scope 到 .corpus-content)→ 发布的 wiki
// reader 页:(a) <head> 有 /api/v1/appearance.css 的 <link>;(b) .corpus-content 内元素
// computed style 反映 owner 规则;(c) 未设 → 无效果;(d) scope 安全:规则动不了 app chrome。

import { test, expect } from '@/fixtures/test';

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
      // owner 写 bare `h2{…}`;后端 scope 成 `.corpus-content h2`。
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
});
