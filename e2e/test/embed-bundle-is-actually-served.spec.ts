// embed-bundle-is-actually-served.spec.ts -- the address we hand out has to point at
// something that exists.
//
// Defect (2026-08-30): CLAUDE.md says embed is a "single `<script>` tag drop-in", and
// `sdk/packages/embed` does actually build -- but in production `/embed.js` and
// `/sdk/embed.js` were both 404. No route was serving it. The promise existed, the
// artifact existed, and the piece connecting them did not.
//
// This belongs to the "ref resolves != ref is a string" family: a doc states an
// address, and nothing verifies it points at something real. So the criterion can't be
// "we remember there's a /embed.js" -- **it has to pull the src out of the exact code
// snippet the product hands the owner, and go fetch that**. Hardcode the path instead,
// and the day the path changes and the panel follows along, this test keeps verifying
// an old address nobody uses.
//
// There are two consumers, and they must not be conflated: the custom page uses the
// build-time-inlined copy (see microsite-html-mode.spec.ts); this file covers the
// **someone else's website** copy.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection, gotoOnHost } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// THIRD_PARTY_HOST -- a domain that resolves back to this machine but is **not**
// localhost (same technique as byoai-insecure-origin.spec.ts). embed exists precisely
// to run on someone else's domain, and testing cross-origin behavior on localhost
// proves nothing -- it's the one privileged origin exempt from TLS
// ([[localhost-is-a-privileged-origin]]).
const THIRD_PARTY_HOST = 'someones-blog.test';
// EMBED_SRC -- the <script src> line on the third-party page. An absolute address: the
// script is fetched from **the instance**.
//
// Uses the same base as the navigate fixture (`APP_BASE_URL`, default 38127 -- the
// app's externally-facing port; 3000 is **inside** the container). Hardcoding 3000
// would fail with "connection refused", which has nothing to do with what this test
// verifies: "can someone else's site actually use it".
const EMBED_SRC = `${process.env['APP_BASE_URL'] ?? 'http://localhost:38127'}/embed.js`;

const OWNER = {
  email: 'embedder@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'embedder',
  fullName: 'Emma Embedder',
};

test.use({
  ownerCredentials: { email: OWNER.email, password: OWNER.password },
  launchOptions: { args: [`--host-resolver-rules=MAP ${THIRD_PARTY_HOST} 127.0.0.1`] },
});
test.describe('embed · the snippet we hand out points at something that exists', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the snippet in api · mcp names a script URL, and that URL serves the bundle',
    async ({ adminPage: page, request }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });

      // The exact code snippet the product gives the owner -- pull the address from
      // here, don't hardcode it.
      const snippet = await page.getByTestId('embed-snippet').innerText();
      const m = /src=["']([^"']+)["']/.exec(snippet);
      expect(m, `no script src in the embed snippet:\n${snippet}`).not.toBeNull();
      const src = new URL(m![1]!, page.url()).toString();

      const res = await request.get(src);
      expect(res.status(), `the snippet points at ${src}`).toBe(200);
      // It's actually JS, not the SPA's fallback serving up an HTML page -- a 200 by
      // itself doesn't prove the response is a script.
      expect(res.headers()['content-type'] ?? '').toMatch(/javascript/i);
      // Someone else's site fetches it cross-origin.
      expect(res.headers()['access-control-allow-origin'] ?? '').toBe('*');

      // And this JS must actually register that element -- "got back a 200'd script"
      // and "got the embed" are two different claims.
      const body = await res.text();
      expect(body).toContain('standmeet-chat');
      expect(body.length).toBeGreaterThan(1000);
    });

  // Asserting an `access-control-allow-origin: *` header, and "someone else's site can
  // actually use it", are two different claims. All of embed's value is in it running
  // **on someone else's domain**; fetching the script fine while its very first API
  // request gets blocked by CORS amounts to handing over something that installs but
  // doesn't work.
  test('loaded from a different origin, the element upgrades and its API call is allowed',
    async ({ page, request }) => {
      // Open the same instance from a different origin (the F-D-14 path), and inject
      // the embed script there.
      await gotoOnHost(page, THIRD_PARTY_HOST, '/');
      const origin = new URL(page.url()).origin;

      const loaded = await page.evaluate(async (src) => {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script failed'));
          document.head.appendChild(s);
        });
        return customElements.get('standmeet-chat') !== undefined;
      }, EMBED_SRC);
      expect(loaded, 'embed 脚本在第三方来源上没有注册那个元素').toBe(true);

      // The first request it makes opens a session. If that's blocked cross-origin,
      // the reader is left staring at a box that spins forever.
      const preflight = await request.fetch(`${BACKEND}/api/v1/sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status(), `OPTIONS /api/v1/sessions from ${origin}`).toBeLessThan(300);
      expect(preflight.headers()['access-control-allow-origin'] ?? '').not.toBe('');

      const real = await request.post(`${BACKEND}/api/v1/sessions`, {
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        data: { mode: 'public', handle: OWNER.handle, visitor_name: 'Cross Origin Cora' },
      });
      expect(real.status()).toBe(200);
      expect(real.headers()['access-control-allow-origin'] ?? '').not.toBe('');
    });

  test('the snippet also names the element the reader will write',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
      // Just a <script> tag alone leaves the owner still not knowing what to write on
      // the page next.
      await expect(page.getByTestId('embed-snippet')).toContainText('<standmeet-chat');
    });
});
