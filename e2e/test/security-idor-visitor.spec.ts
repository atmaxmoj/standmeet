// security-idor-visitor.spec.ts —— pentest / IDOR. GET /conversations/{id} is token-scoped: the handler
// ignores the {id} in the URL and always returns the caller's **own** session data resolved from the
// Bearer token (getConversation → authVisitorWithToken → the caller's own av.Data). So Bob hitting it
// with Alice's conv id only gets Bob's own conversation, never leaking Alice. Contract: the response
// carries the caller's own visitor_name.
// green = no cross-session data leak; red = able to read someone else's conversation (a real IDOR).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function getConversation(
  request: APIRequestContext, token: string, convID: string,
): Promise<{ status: number; body: string }> {
  const res = await request.get(`${BACKEND}/api/v1/conversations/${convID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: await res.text() };
}

test.describe('pentest · visitor IDOR (cross-session resource access)', () => {
  let seed: BaseSeed;
  let alice: VisitorSession;
  let bob: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const code = await createCode(seed.request, seed.csrf, { code: 'IDOR-VIS1', label: 'idor' });
    alice = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'AliceIdorSecret',
    });
    bob = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'BobIdorPlain',
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('Bob aiming his token at Alice\'s conversation id gets his OWN data, never Alice\'s',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // sanity: Alice reads her own conversation, sees her own name.
      const own = await getConversation(request, alice.session_token, alice.conversation_id);
      expect(own.status, 'Alice reads her own conversation').toBe(200);
      expect(own.body).toContain('AliceIdorSecret');
      // IDOR attempt: Bob's token + Alice's conversation id. Token-scoped handler ignores the id
      // → returns Bob's own conversation. No Alice data bleeds.
      const idor = await getConversation(request, bob.session_token, alice.conversation_id);
      expect(idor.status, 'request resolves against Bob\'s own session').toBe(200);
      expect(idor.body, 'Bob sees his own name').toContain('BobIdorPlain');
      expect(idor.body, 'no Alice data crosses over').not.toContain('AliceIdorSecret');
      await request.dispose();
    });
});
