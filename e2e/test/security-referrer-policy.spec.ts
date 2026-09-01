// security-referrer-policy.spec.ts —— 访问码不能随 Referer 出门。
//
// pentest 2026-09-01：访问码坐在 URL 的 query 里（简历 QR = `/<handle>?code=ABC`）。
// 入口 hook 会立刻 history.replaceState 抹掉它，但首屏那一瞬 JS 还没跑，跨源子资源请求
// 会把含码的完整 URL 放进 Referer 头，泄给外部主机。
//
// 契约：app 对所有路径发 `Referrer-Policy: strict-origin-when-cross-origin` ——
// 同源照常，跨源只发 origin（不含 query），码从此不随 Referer 出门。
// RED（加头之前）：没有 Referrer-Policy 头。

import { test, expect } from '@/fixtures/test';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:38127';

test.describe('security · the access code must not ride out in the Referer header', () => {
  test('the app sets Referrer-Policy so a cross-origin subresource cannot leak ?code=',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.get(BASE_URL, { headers: { Accept: 'text/html' } });
      const policy = res.headers()['referrer-policy'] ?? '';
      expect(policy,
        '没有 Referrer-Policy → 首屏跨源子资源会把含 ?code= 的完整 URL 放进 Referer')
        .toBe('strict-origin-when-cross-origin');
      await request.dispose();
    });
});
