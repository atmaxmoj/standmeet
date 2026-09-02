// render-widget.spec.ts — the `standmeet-widget` sandboxed iframe block (RED-first,
// not yet implemented).
//
// Design (rendering-and-extensibility.md §25-28/§32/§42-44): dynamic content is never
// imported as a plugin; it goes through a fenced ` ```standmeet-widget ` block, with the
// descriptor (src/height/sandbox/seo) inside the block; it renders as a **sandboxed
// <iframe>** (the Figma/VS-Code-webview model of iframe + postMessage); widget content
// is user-provided → it **must be sandboxed**; `seo:false` (the default) → it only
// mounts client-side (a mount-guard), invisible to crawlers/SSR (design
// non-negotiable §44).
//
// v1 contract (the postMessage protocol comes later): the descriptor parses →
// a sandboxed iframe mounts, src/height take effect, and the mount is client-side
// (seo:false). Warning: RED until WidgetBlock is implemented.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { goto } from '@/fixtures/navigate';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('renderwidget');

const WIDGET = [
  '```standmeet-widget',
  '{ "src": "https://example.com/w", "height": 240 }',
  '```',
].join('\n');

test.describe('render · standmeet-widget sandboxed iframe', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a standmeet-widget block mounts a sandboxed iframe with src + height',
    async ({ request, page }) => {
      await uploadVault(request, OWNER, [
        { rel: 'wiki/widget.md', body: makeVaultMD({ publish: true }, `## W\n\n${WIDGET}`) },
      ]);
      await goto(page, '/wiki/widget');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      const frame = doc.locator('iframe[data-testid="widget-iframe"]');
      await expect(frame).toHaveCount(1);
      // sandbox is mandatory (user-provided content isolation).
      await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
      await expect(frame).toHaveAttribute('src', 'https://example.com/w');
    });

  test('a malformed widget descriptor degrades (no iframe, no crash)',
    async ({ request, page }) => {
      const bad = ['```standmeet-widget', 'not json at all', '```'].join('\n');
      await uploadVault(request, OWNER, [
        { rel: 'wiki/badwidget.md', body: makeVaultMD({ publish: true }, `## W\n\n${bad}`) },
      ]);
      await goto(page, '/wiki/badwidget');
      const doc = page.getByTestId('wiki-body');
      await expect(doc).toBeVisible();
      await expect(doc.locator('iframe[data-testid="widget-iframe"]')).toHaveCount(0);
    });
});
