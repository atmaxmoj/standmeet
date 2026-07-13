// public-cors.spec.ts —— F-O-1 regression guard.
//
// Real-env verification found the /api/v1 visitor surface emitted NO
// Access-Control-* headers and answered OPTIONS preflight with 405. The
// shipped @standmeet/embed / @standmeet/sdk load from a third-party origin
// and authenticate with the Bearer token from /sessions; without CORS the
// browser blocks every cross-origin request and the embed can't bootstrap.
//
// Why CI missed it: the app dogfoods its own copy same-origin, and zero specs
// exercised a cross-origin request. This asserts wide-open CORS (D.2) directly
// against the backend, with an Origin header, the way a real embed would.

import { test, expect } from '@/fixtures/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const ORIGIN = 'https://someone-elses-site.example';

test.describe('public · CORS is wide open for cross-origin SDK embeds (F-O-1)', () => {
  test('OPTIONS preflight to /sessions is allowed with Access-Control headers',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.fetch(`${BACKEND}/api/v1/sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });
      // Must NOT be the old 405; preflight is answered.
      expect(res.status(), 'preflight must not be 405').toBeLessThan(400);
      const headers = res.headers();
      expect(headers['access-control-allow-origin'], 'ACAO present').toBeTruthy();
      expect(headers['access-control-allow-methods'] ?? '').toMatch(/POST/i);
      await request.dispose();
    });

  test('a cross-origin GET carries Access-Control-Allow-Origin',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.get(`${BACKEND}/api/v1/instance`, {
        headers: { Origin: ORIGIN },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()['access-control-allow-origin'], 'ACAO present on the real response')
        .toBeTruthy();
      await request.dispose();
    });
});
