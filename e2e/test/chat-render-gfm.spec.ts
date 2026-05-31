// chat-render-gfm.spec.ts —— GFM 扩展：table / strikethrough / autolink。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

test.describe('chat render · GFM table / strikethrough / autolink', () => {
  test('table renders <table>; ~~strike~~ → <del>; bare URL → autolink',
    async ({ page }) => {
      await goto(page, '/dev/chat-render?fixture=gfm');
      const out = page.getByTestId('render-out');
      // table
      await expect(out.locator('table')).toBeVisible();
      await expect(out.locator('table th').first()).toContainText('col1');
      await expect(out.locator('table td').first()).toContainText('a');
      // strikethrough
      await expect(out.locator('del')).toHaveText('strike');
      // autolink
      await expect(out.locator('a')).toHaveAttribute('href', 'https://example.com');
    });
});
