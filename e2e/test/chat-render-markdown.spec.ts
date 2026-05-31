// chat-render-markdown.spec.ts —— ChatMarkdown 渲染基础 markdown 语法：
// heading、bold、italic、inline code、list、link。
// 跑在 /dev/chat-render?fixture=markdown 上。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('chat render · basic markdown syntax', () => {
  test('heading / bold / italic / inline code / list / link all render',
    async ({ page }) => {
      await goto(page, '/dev/chat-render?fixture=markdown');
      const out = page.getByTestId('render-out');
      await expect(out.locator('h1')).toHaveText('Heading');
      await expect(out.locator('strong')).toHaveText('bold');
      await expect(out.locator('em')).toHaveText('italic');
      await expect(out.locator('code').first()).toHaveText('inline code');
      await expect(out.locator('li').first()).toContainText('item one');
      await expect(out.locator('a')).toHaveAttribute('href', 'https://example.com');
    });
});
