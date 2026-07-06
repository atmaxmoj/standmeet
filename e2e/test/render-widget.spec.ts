// render-widget.spec.ts —— `standmeet-widget` 沙箱 iframe 块(RED-first,待实现)。
//
// 设计(rendering-and-extensibility.md §25-28/§32/§42-44):动态内容不 import 插件,走一个
// fenced ` ```standmeet-widget ` 块,descriptor(src/height/sandbox/seo)在块内;渲染成
// **sandboxed <iframe>**(iframe + postMessage 的 Figma/VS-Code-webview 模型);widget 内容是
// user-provided → **必须 sandbox**;`seo:false`(默认)→ 客户端才挂(mount-guard),爬虫/SSR
// 看不到(design 非-negotiable §44)。
//
// v1 契约(postMessage 协议后置):descriptor 解析 → 带 sandbox 的 iframe 挂上,src/height 生效,
// 且是客户端挂载(seo:false)。⚠️ RED until WidgetBlock 实现。

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
