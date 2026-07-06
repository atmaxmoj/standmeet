// render-static-passthrough.spec.ts —— pre-render-at-export(#2)的验证:StandMeet 从不跑
// Obsidian 插件,只 ingest owner 在导出侧烤好的**静态结果**。
//
// 设计(rendering-and-extensibility.md §31/§39):plugin 在 Obsidian 侧 export 时预渲染,
// StandMeet 直接把静态 markdown 收进正文。所以:预烤的表格 → 真 `<table>`;裸的
// ` ```dataview ` 块 → 退化成 `<pre>/<code>`(不执行、不崩)。StandMeet 侧无需新建代码。

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('renderstatic');

test.describe('render · pre-rendered static passes through; raw plugin block degrades', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a Dataview-baked static table renders as a real <table>',
    async ({ request, page }) => {
      const body = [
        '## Projects',
        '',
        '| Project | Status |',
        '| --- | --- |',
        '| Lucerna | shipped |',
        '| Atlas | wip |',
      ].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/baked.md', body: makeVaultMD({ publish: true }, body) },
      ]);
      await goto(page, '/wiki/baked');
      const doc = page.getByTestId('wiki-body');
      await expect(doc.locator('table')).toBeVisible();
      await expect(doc.locator('table')).toContainText('Lucerna');
      await expect(doc.locator('table')).toContainText('shipped');
    });

  test('a raw un-rendered ```dataview block degrades to code — never executed, no crash',
    async ({ request, page }) => {
      const body = [
        '## Raw plugin block',
        '',
        '```dataview',
        'TABLE status FROM #project',
        '```',
      ].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/rawdv.md', body: makeVaultMD({ publish: true }, body) },
      ]);
      await goto(page, '/wiki/rawdv');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      // the query text is shown verbatim inside a code block, not evaluated.
      await expect(doc.locator('code')).toContainText('TABLE status FROM #project');
      // no table was produced from the raw block (StandMeet never ran the plugin).
      await expect(doc.locator('table')).toHaveCount(0);
    });
});
