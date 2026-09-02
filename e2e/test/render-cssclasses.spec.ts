// render-cssclasses.spec.ts —— per-note cssclasses genuinely renders.
//
// note frontmatter `cssclasses:[boxed]` → the reader's inner div carries the class
// boxed (inside .corpus-content), and the owner's `.boxed` rule (scoped to
// `.corpus-content .boxed`) matches it. No cssclasses → no such class.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { adminSetCSS } from '@/fixtures/presentation';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('rendercls');

test.describe('render · per-note cssclasses applies on the reader', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('cssclasses:[boxed] → inner div carries the class + owner .boxed rule matches it',
    async ({ request, page }) => {
      // bare `.boxed{…}` → scoped to `.corpus-content .boxed`(inner div).
      const status = await adminSetCSS(request, OWNER, '.boxed { border-style: dashed; }');
      expect(status).toBe(200);
      await uploadVault(request, OWNER, [
        { rel: 'wiki/boxed.md', body: makeVaultMD({ publish: true, cssclasses: ['boxed'] }, '## H\n\nb') },
      ]);
      await goto(page, '/wiki/boxed');
      const inner = page.getByTestId('wiki-body').locator('.corpus-content > .boxed');
      await expect(inner).toHaveCount(1);
      await expect(inner).toHaveCSS('border-style', 'dashed');
    });

  test('no cssclasses → no .boxed inner class',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/nobox.md', body: makeVaultMD({ publish: true }, '## H\n\nb') },
      ]);
      await goto(page, '/wiki/nobox');
      await expect(page.getByTestId('wiki-body').locator('.corpus-content')).toHaveCount(1);
      await expect(page.getByTestId('wiki-body').locator('.boxed')).toHaveCount(0);
    });
});
