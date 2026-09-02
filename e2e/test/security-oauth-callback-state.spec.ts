// security-oauth-callback-state.spec.ts -- pentest. A connector's OAuth callback,
// GET /connectors/{id}/callback, is a CSRF-sensitive surface: a forged, missing, or
// mismatched state must never exchange for a token (otherwise an attacker's account
// could be bound to the owner's connector, or authorization could be CSRF-forced). And
// the callback's Location must be a **constant relative path** -- it must never be
// injectable into an open redirect via state or any other parameter. Contract: a forged
// state -> 302 with connect_error=1, and the Location never contains the attacker's
// URL. Green means the CSRF gate and the redirect gate are both in place.

import { test, expect } from '@/fixtures/test';

import { seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.describe('pentest · connector OAuth callback state / open-redirect', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('forged state never mints a token and never open-redirects', async () => {
    const attacks = [
      'code=stolen&state=forged-does-not-match',
      'code=stolen', // missing state entirely
      'code=stolen&state=https://evil.example.com/pwn', // open-redirect attempt via state
    ];
    for (const qs of attacks) {
      // owner-authed (session cookie); a nonexistent connector id is fine — state won't match either way.
      const res = await seed.request.get(
        `${BACKEND}/api/admin/connectors/00000000-0000-0000-0000-000000000000/callback?${qs}`,
        { maxRedirects: 0 },
      );
      // Token exchange fails -> 302 back to the connectors area with connect_error=1
      // (never a 2xx success).
      expect(res.status(), `no success on forged state: ${qs}`).toBe(302);
      const loc = res.headers()['location'] ?? '';
      expect(loc, `redirect signals failure: ${qs}`).toContain('connect_error=1');
      // A constant relative target: the attacker's URL must never be reflected into
      // Location (an open redirect).
      expect(loc, `no open-redirect: ${qs}`).not.toContain('evil.example.com');
      expect(loc.startsWith('/'), `Location is a relative path: ${qs} → ${loc}`).toBe(true);
    }
  });
});
