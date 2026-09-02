// leverage-static-html.spec.ts —— Obsidian-ecosystem leverage #2: pre-render-at-export。
//
// Design ([[rendering-and-extensibility]] §31/§39): plugins (Dataview/etc.) pre-render to a
// **static result** on the owner's Obsidian side at export time; StandMeet only ingests that
// result and never runs the plugin. Cases that bake to markdown (Dataview Publisher ->
// markdown table) already render fine (see render-static-passthrough); cases that bake to
// **HTML** (Digital Garden / some HTML exports) currently get stripped by rehype-sanitize ->
// this is what StandMeet needs to build: a ` ```standmeet-html ` block whose content is the
// owner's pre-baked static HTML, rendered into the body **after sanitizing** (safe tags kept,
// script/iframe/on* stripped).
//
// ⚠️ RED until the standmeet-html block is implemented.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('leveragehtml');

test.describe('leverage · pre-rendered static HTML (baked at export) renders, sanitized', () => {
  // This one test alone has to walk through reset -> claim -> upload vault -> open the
  // reader page, and the reader page waits on `load` (fonts + lazy-loaded mermaid). The
  // default 30s isn't enough under full-suite load; it takes 42s solo.
  // **Do not loosen `goto` to domcontentloaded** -- that would hide the class of "only
  // happens after fonts land" layout bugs like F-A-43 from the whole suite. Give this test
  // the time it needs, and keep that boundary local to itself.
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
