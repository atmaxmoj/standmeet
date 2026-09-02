// visitor-client-ip-through-app.spec.ts — F-F-5. A visitor's source address must be
// **the visitor's own**, or else it must be recorded as unknown — never allowed to be
// the intermediate hop impersonating them.
//
// The factory-default shape is browser → app (a Next rewrite `/api/:path*`) → backend,
// with nobody in between writing X-Forwarded-For (`make prod-up` says "TLS/domain is
// external", the reverse proxy is the owner's own). At that point chi.RealIP finds no
// header, RemoteAddr stops at the **app container**, and so every single visitor gets
// recorded as the same address. The consequence isn't just ugly: the owner's
// conversations page has a column literally called IP, and the ip-bans page tells them
// to "Find offending IPs in conversations" — following that advice bans every visitor
// at once; and the per-IP brute-force lock turns into one global bucket, where one
// person's 10 wrong tries locks everyone out for 15 minutes.
//
// This guard **must go through the app hop** (BASE_URL), never connect directly to the
// backend — connecting directly is exactly what bypasses the hop where the bug lives.
// The existing security-captcha-bypass connects directly to :8000 and forges its own
// XFF, so it can never go red on this dimension.
//
// Both directions must be asserted together; missing either lets a fake fix of "just
// clear every IP" slip through:
//   1) no forwarding header → what's recorded is empty (unknown), not the hop's private
//      network address
//   2) a forwarding header  → what's recorded **is exactly** the address in that
//      header, byte for byte

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const APP = process.env['BASE_URL'] ?? 'http://localhost:38127';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'clientip@example.com',
  password: 'client-ip-pass-123',
  handle: 'clientip',
  fullName: 'Client IP Owner',
};

// A documentation-range address (RFC 5737) — it can only have come from the header.
const FORWARDED = '203.0.113.9';

// owner — the context logged in during beforeAll (carrying the session cookie). Every
// admin read goes through it.
let owner: APIRequestContext;
let csrf = '';

// issueThroughApp — opens a session via the app hop. Leaving headers empty = the
// factory-default shape (no forwarding header).
async function issueThroughApp(
  request: APIRequestContext, code: string, visitor: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await request.post(`${APP}/api/v1/sessions`, {
    headers, data: { handle: OWNER.handle, mode: 'code', code, visitor_name: visitor },
  });
  expect(res.status(), 'session issued through the app hop').toBe(200);
}

// recordedIP — the source IP the owner sees in that column on /admin/conversations.
// Fetches the row by visitor name: this is exactly the column the ip-bans page tells
// the owner to copy from, so the assertion must be against the data he actually sees.
async function recordedIP(visitor: string): Promise<string> {
  const res = await owner.get(`${BACKEND}/api/admin/conversations`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), 'owner lists conversations').toBe(200);
  const rows = await res.json() as Array<{ visitor_name: string; client_ip: string }>;
  const row = rows.find((r) => r.visitor_name === visitor);
  expect(row, `a row for ${visitor}`).toBeDefined();
  return row?.client_ip ?? '<no row>';
}

test.describe('F-F-5 · the visitor address is the visitor, or it is unknown', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance needs ~48s under load, and the hook defaults to only 30s
    resetInstance();
    owner = await playwright.request.newContext();
    await claim(owner, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(owner, OWNER.email, OWNER.password));
    const apiToken = await createAPIToken(owner, csrf, 'client-ip-seed');
    const sid = await initMCP(owner, apiToken);
    await seedPublicWiki(owner, apiToken, sid, {
      body: 'client ip intro.', title: 'Client IP Intro', path: 'clientip/intro',
    });
    await createCode(owner, csrf, { code: 'CLIENTIP-1', label: 'clientip' });
  });

  test.afterAll(async () => { await owner.dispose(); });

  test('no forwarding header through the app hop → the address is unknown, not the hop',
    async ({ playwright }) => {
      const visitor = await playwright.request.newContext();
      await issueThroughApp(visitor, 'CLIENTIP-1', 'Unforwarded', {});
      // This is the line that's currently red: what's recorded today is the app
      // container's private network address (172.x), so every visitor gets the same
      // value.
      expect(await recordedIP('Unforwarded'),
        'an unknowable address is recorded as unknown, never as the proxy hop').toBe('');
      await visitor.dispose();
    });

  test('a forwarding header through the app hop → that exact address is recorded',
    async ({ playwright }) => {
      const visitor = await playwright.request.newContext();
      await issueThroughApp(
        visitor, 'CLIENTIP-1', 'Forwarded', { 'X-Forwarded-For': FORWARDED },
      );
      // The reverse assertion: the fix must not be "clear every IP unconditionally" —
      // a real address must survive unchanged, or the owner's ban capability would be
      // fixed right out of existence.
      expect(await recordedIP('Forwarded'),
        'a forwarded address survives the hop unchanged').toBe(FORWARDED);
      await visitor.dispose();
    });
});
