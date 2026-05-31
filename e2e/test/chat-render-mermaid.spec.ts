// chat-render-mermaid.spec.ts —— ```mermaid 代码块异步渲染成 <svg>。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('chat render · mermaid code block', () => {
  test('```mermaid block → MermaidBlock lazy renders <svg>',
    async ({ page }) => {
      await goto(page, '/dev/chat-render?fixture=mermaid');
      const svg = page.getByTestId('mermaid-svg').locator('svg');
      // mermaid 异步加载 + render；等 svg 出现
      await expect(svg).toBeVisible({ timeout: 10_000 });
    });
});
