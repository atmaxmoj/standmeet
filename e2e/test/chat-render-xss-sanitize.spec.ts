// chat-render-xss-sanitize.spec.ts —— sanitize 兜底：raw HTML
// (<script>、<img onerror>) 不该渲也不该执行。
//
// 现状：rehype-sanitize 替换了 rehype-raw —— raw HTML 全部被剔除。
// 跑 fixture 后检查：DOM 不含 <script>，window.__pwned 未被赋值。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';

interface PwnedWindow extends Window {
  __pwned?: boolean;
  __pwned_img?: boolean;
}

test.describe('chat render · XSS sanitize', () => {
  test('<script> tag stripped; onerror handler does not fire',
    async ({ page }) => {
      await goto(page, '/dev/chat-render?fixture=xss');
      const out = page.getByTestId('render-out');
      // sanity: 前后文本仍渲染
      await expect(out).toContainText('Before');
      await expect(out).toContainText('After');
      // DOM 不应含 script tag
      const scripts = await out.locator('script').count();
      expect(scripts).toBe(0);
      // 即使图片标签被保留，onerror handler 不该执行 (sanitize 剔除事件属性)
      const pwned = await page.evaluate(() => {
        const w = window as PwnedWindow;
        return { script: w.__pwned === true, img: w.__pwned_img === true };
      });
      expect(pwned.script, '<script> executed').toBe(false);
      expect(pwned.img, 'onerror executed').toBe(false);
    });
});
