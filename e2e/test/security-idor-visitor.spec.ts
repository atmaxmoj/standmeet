// security-idor-visitor.spec.ts —— pentest / IDOR。GET /conversations/{id} 是 token-scoped:
// handler 忽略 URL 里的 {id},始终按 Bearer token 解出调用者**自己**的 session data 返回
// (getConversation → authVisitorWithToken → 自己的 av.Data)。所以 Bob 拿 Alice 的 conv id
// 打过去,只会拿到 Bob 自己的对话,绝不泄漏 Alice。契约:响应带的是调用者自己的 visitor_name。
// 绿=无跨会话数据串;红=能读到别人的 conversation(真 IDOR)。

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
