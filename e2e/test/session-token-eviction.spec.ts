// session-token-eviction.spec.ts —— 已发出的 session token,一旦 Redis 里的
// `vsession:{token}` 没了(TTL 到期 / eviction / 显式删),下一次 /agent/turn 必须
// **401 "invalid session"**。
//
// 补 invalidation 覆盖缺口:iam-revoke-blocks-next-turn 测的是「code 被 revoke →
// turn 拒」(token 还在,code 死);这条测的是「**token 自身**没了 → 拒」,即
// authVisitorWithToken 里 Sessions.Get 失败的那条路径,之前没测。

import { test, expect } from '@/fixtures/test';
import { execSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';

const OWNER = {
  email: 'evict@example.com', password: 'correct-horse-battery-staple',
  handle: 'evictowner', fullName: 'Evict Owner',
};
const CODE = 'EVICT-1';

test.describe('an evicted/expired session token is rejected on the next turn', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'evict' });
    await request.dispose();
  });

  test('first turn ok → evict redis vsession → next turn 401',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sam',
      });
      // 第一条 turn:token 有效 → 200。
      expect((await turn(request, sess)).status()).toBe(200);
      // 模拟 TTL 到期 / eviction:把 vsession:* 从 Redis 删掉。
      evictVisitorSessions();
      // 同一 token 再发:Sessions.Get 查不到 → 401 "invalid session"。
      expect((await turn(request, sess)).status()).toBe(401);
      await request.dispose();
    });
});

function evictVisitorSessions(): void {
  const script = 'redis-cli --scan --pattern "vsession:*" | xargs -r redis-cli DEL';
  execSync(`docker exec ${REDIS_CONTAINER} sh -c '${script}'`, { stdio: 'pipe' });
}

async function turn(request: APIRequestContext, sess: VisitorSession) {
  return request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    data: { system: 'You are the owner.', user_message: 'hi' },
  });
}
