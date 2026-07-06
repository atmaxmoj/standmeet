// render-callouts.spec.ts —— Obsidian callout(`> [!type] Title`)真渲染。
//
// `> [!theorem] Pythagoras` blockquote → `blockquote.callout[data-callout=theorem]` +
// `.callout-title`="Pythagoras",body 保留。普通 blockquote 不被误转成 callout。

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('rendercallout');

test.describe('render · Obsidian callouts on the reader', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('`> [!theorem] Title` → callout box with data-callout + title, body preserved',
    async ({ request, page }) => {
      const body = [
        '## H',
        '',
        '> [!theorem] Pythagoras',
        '> For a right triangle, the square of the hypotenuse.',
        '',
        '> [!warning] Careful',
        '> Watch out.',
      ].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/callout.md', body: makeVaultMD({ publish: true }, body) },
      ]);
      await goto(page, '/wiki/callout');
      const doc = page.getByTestId('wiki-body');

      const theorem = doc.locator('.callout[data-callout="theorem"]');
      await expect(theorem).toHaveCount(1);
      await expect(theorem.locator('.callout-title')).toHaveText('Pythagoras');
      await expect(theorem).toContainText('square of the hypotenuse');

      await expect(doc.locator('.callout[data-callout="warning"] .callout-title')).toHaveText('Careful');
    });

  test('a plain blockquote (no [!type]) stays a normal blockquote, not a callout',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/plainbq.md', body: makeVaultMD({ publish: true }, '## H\n\n> just a quote') },
      ]);
      await goto(page, '/wiki/plainbq');
      const doc = page.getByTestId('wiki-body');
      await expect(doc.locator('blockquote')).toHaveCount(1);
      await expect(doc.locator('.callout')).toHaveCount(0);
    });
});
