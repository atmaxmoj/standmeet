// render-static-passthrough.spec.ts — verification of pre-render-at-export (#2):
// StandMeet never runs the Obsidian plugin, it only ingests the **static, already-baked
// output** the owner produces on the export side.
//
// Design (rendering-and-extensibility.md §31/§39): the plugin pre-renders at export
// time on the Obsidian side, and StandMeet just takes the static markdown straight
// into the body. So: a pre-baked table → a real `<table>`; a bare ` ```dataview `
// block → degrades to `<pre>/<code>` (never executed, never crashes). No new code
// needed on the StandMeet side.

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
