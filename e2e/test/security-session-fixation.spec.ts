// security-session-fixation.spec.ts —— pentest. A visitor session only accepts a
// **server-minted** smv_ token (32B random). An attacker must not be able to (a)
// forge/guess a token to impersonate a session, or (b) take the owner's sms_ token
// through the visitor surface to escalate privilege. Contract: a Bearer that wasn't
// server-minted → 401, and resolves no session at all. Green = the token cannot be
// forged; red = session fixation/privilege escalation.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function getConvStatus(
  request: APIRequestContext, token: string, convID: string,
): Promise<number> {
  const res = await request.get(`${BACKEND}/api/v1/conversations/${convID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status();
}

test.describe('pentest · visitor session fixation / token forgery', () => {
  let seed: BaseSeed;
  let victim: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const code = await createCode(seed.request, seed.csrf, { code: 'FIXATE-1', label: 'fix' });
    victim = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'Victim',
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('forged / guessed / owner tokens never resolve a visitor session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const conv = victim.conversation_id;
      // sanity: the real server-minted token works.
      expect(await getConvStatus(request, victim.session_token, conv),
        'real minted token resolves').toBe(200);

      const forged = [
        'smv_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // right prefix, fake body
        'smv_', // empty body
        'sms_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // OWNER token prefix (privesc)
        victim.session_token.slice(0, -4) + 'AAAA', // last-bytes tamper of a real token
        '../../etc/passwd', // junk
      ];
      for (const token of forged) {
        expect(await getConvStatus(request, token, conv),
          `forged token must not resolve: ${token.slice(0, 12)}…`).toBe(401);
      }
      await request.dispose();
    });
});
