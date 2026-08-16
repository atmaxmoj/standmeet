// render-owner-css.spec.ts —— owner 自定义 CSS 真渲染(不是只后端存/读)。
//
// owner 从 admin 存一段 CSS(后端 sanitize + scope 到 .corpus-content)→ 发布的 wiki
// reader 页:(a) <head> 有 /api/v1/appearance.css 的 <link>;(b) .corpus-content 内元素
// computed style 反映 owner 规则;(c) 未设 → 无效果;(d) scope 安全:规则动不了 app chrome。

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

  // owner 的 snippet 是照 **Obsidian 的变量方言**写的 —— 那是他 vault 里 lint 过的东西。
  // 站点收下它、消毒、加 scope 前缀，却一个变量都没定义 → 规则生效了但**什么也没改变**
  // （F-L-36：真 vault 里 `[!definition]`(绿) 和 `[!theorem]`(蓝) 渲成同一块淡红）。
  // 这两条守的就是那份契约：**owner 写什么，页面上就得是什么。**
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
      // 左边那道竖线就是上色的机制本身 —— owner 说蓝，它就得是蓝，不是站点的 vermillion。
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

// seedCalloutNote —— 一条已发布的笔记，正文就是一个 callout。
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
