// admin-allowed-domains.spec.ts -- owner-maintained custom-domain allowlist for
// on-demand TLS (GET/POST/DELETE /api/admin/allowed-domains).
//
// This batch of routes gets its capability from the **outbound convergence point**
// (backend/internal/routes/dispatcher): the domain exports a plain function, the
// convergence point declares the op, and the admin facade only owns the REST shape.
// So this spec guards two things at once:
//
//   1. The functionality itself -- add it and it lists; delete it and it's gone;
//      deleting again does not error (idempotent);
//   2. **The facade's own contract** -- add / remove return 204 with an empty
//      body, list returns 200 + {"domains":[...]}.
//      The convergence point hands back one payload; the status code is this
//      facade's own decision. Pin it here so a future migration doesn't quietly
//      turn 204 into 200 unnoticed (the frontend relies on 204).
//
// The real DNS / TLS check goes through /internal/tls-ask and is out of scope
// for this spec.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { login } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DOMAIN = 'me.example.com';

const OWNER = {
  email: 'domains@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'domainsowner',
  fullName: 'Domains Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin allowed domains', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('add → listed → remove → gone（并锁住 204 / 200 的形状）',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        const { csrf } = await login(request, OWNER.email, OWNER.password);

        expect(await listDomains(request)).not.toContain(DOMAIN);

        const added = await request.post(`${BACKEND}/api/admin/allowed-domains`, {
          headers: { 'X-Csrftoken': csrf },
          data: { domain: DOMAIN },
        });
        expect(added.status()).toBe(204);
        expect(await added.text()).toBe('');
        expect(await listDomains(request)).toContain(DOMAIN);

        const removed = await request.delete(
          `${BACKEND}/api/admin/allowed-domains/${DOMAIN}`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(removed.status()).toBe(204);
        expect(await listDomains(request)).not.toContain(DOMAIN);

        // idempotent: deleting one that doesn't exist does not error.
        const again = await request.delete(
          `${BACKEND}/api/admin/allowed-domains/${DOMAIN}`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(again.status()).toBe(204);
      } finally {
        await request.dispose();
      }
    });

  test('空域名 → 400，不是 500（收口说“调用方给错了”，本面翻成 400）',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        const { csrf } = await login(request, OWNER.email, OWNER.password);
        const res = await request.post(`${BACKEND}/api/admin/allowed-domains`, {
          headers: { 'X-Csrftoken': csrf },
          data: { domain: '' },
        });
        expect(res.status()).toBe(400);
        expect(await res.text()).toContain('domain is required');
      } finally {
        await request.dispose();
      }
    });
});

async function listDomains(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/allowed-domains`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { domains: string[] };
  return body.domains;
}
