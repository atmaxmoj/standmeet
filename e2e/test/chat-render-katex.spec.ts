// chat-render-katex.spec.ts —— LaTeX inline + display 渲染。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('chat render · KaTeX inline + display math', () => {
  test('$...$ inline + $$...$$ display both render with .katex classes',
    async ({ page }) => {
      await goto(page, '/dev/chat-render?fixture=katex');
      const out = page.getByTestId('render-out');
      // inline + display 都生成 .katex 元素
      await expect(out.locator('.katex').first()).toBeVisible();
      // display 块单独有 .katex-display container
      await expect(out.locator('.katex-display')).toBeVisible();
    });
});
