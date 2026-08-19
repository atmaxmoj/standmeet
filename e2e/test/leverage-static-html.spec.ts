// leverage-static-html.spec.ts —— Obsidian-ecosystem leverage #2: pre-render-at-export。
//
// 设计([[rendering-and-extensibility]] §31/§39):plugin(Dataview/etc.)在 owner 的 Obsidian 侧
// export 时预渲染成**静态结果**,StandMeet 只 ingest 那个结果、从不跑插件。烤成 markdown 的
// (Dataview Publisher → markdown 表)本来就渲(见 render-static-passthrough);烤成 **HTML** 的
// (Digital Garden / 某些 HTML 导出)现在被 rehype-sanitize 剥掉 → 这就是 StandMeet 侧要建的:
// 一个 ` ```standmeet-html ` 块,内容是 owner 预烤的静态 HTML,**sanitize 后**渲进正文
// (安全标签留下、script/iframe/on* 剥掉)。
//
// ⚠️ RED until standmeet-html 块实现。

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('leveragehtml');

test.describe('leverage · pre-rendered static HTML (baked at export) renders, sanitized', () => {
  // 这条用例一个人要走完 reset → claim → 上传 vault → 开 reader 页面，而 reader 那页要等
  // `load`（字体 + 懒加载的 mermaid）。默认 30 秒在全套负载下不够，单跑 42 秒。
  // **不把 `goto` 放宽成 domcontentloaded** —— 那样会把 F-A-43 那类「字体落地之后才发生」的
  // 布局缺陷从整套里藏起来。给这条用例它自己需要的时间，边界留在它自己身上。
  test.setTimeout(90_000);

  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a standmeet-html block renders the owner-baked table into the body',
    async ({ request, page }) => {
      const baked = [
        '```standmeet-html',
        '<table><thead><tr><th>Project</th><th>Metric</th></tr></thead>'
          + '<tbody><tr><td>Lucerna</td><td>+71%</td></tr></tbody></table>',
        '```',
      ].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/baked-html.md', body: makeVaultMD({ publish: true }, `## Report\n\n${baked}`) },
      ]);
      await goto(page, '/wiki/baked-html');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      // the baked HTML becomes real DOM (a <table>), not verbatim text.
      await expect(doc.locator('table')).toBeVisible();
      await expect(doc.locator('table td').first()).toHaveText('Lucerna');
    });

  test('script / event-handler in a baked HTML block is sanitized away (no execution)',
    async ({ request, page }) => {
      const evil = [
        '```standmeet-html',
        '<div id="ok">safe</div><script>window.__pwned = true</script>'
          + '<img src="x" onerror="window.__pwned_img = true">',
        '```',
      ].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/evil-html.md', body: makeVaultMD({ publish: true }, `## X\n\n${evil}`) },
      ]);
      await goto(page, '/wiki/evil-html');
      const doc = page.getByTestId('wiki-body');
      await expect(doc.locator('#ok')).toHaveText('safe');
      await expect(doc.locator('script')).toHaveCount(0);
      // neither the inline script nor the onerror handler ran.
      const pwned = await page.evaluate(() => ({
        s: (window as unknown as { __pwned?: boolean }).__pwned === true,
        i: (window as unknown as { __pwned_img?: boolean }).__pwned_img === true,
      }));
      expect(pwned.s).toBe(false);
      expect(pwned.i).toBe(false);
    });
});
