// security-referrer-policy.spec.ts — an access code must not travel out via the Referer header.
//
// Pentest 2026-09-01: the access code sits in the URL's query string (a resume QR code =
// `/<handle>?code=ABC`). The entry hook immediately calls history.replaceState to wipe it, but
// for that first instant before JS has run, a cross-origin subresource request would put the
// full URL — code included — into the Referer header, leaking it to an external host.
//
// Contract: the app sends `Referrer-Policy: strict-origin-when-cross-origin` on every path —
// same-origin behaves as usual, cross-origin only sends the origin (no query string), so the
// code no longer travels out via Referer.
// RED (before the header was added): no Referrer-Policy header present.

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
