// security-session-fixation.spec.ts —— pentest。访客会话只认**服务端铸造**的 smv_ token
// (32B 随机)。攻击者不能 (a) 伪造/猜一个 token 冒充会话,(b) 拿 owner 的 sms_ token 走访客面
// 提权。契约:非服务端铸造的 Bearer → 401,不 resolve 出任何会话。绿=token 不可伪造;红=会话固定/提权。

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
