// session-token-eviction.spec.ts -- once an issued session token's `vsession:{token}` key is
// gone from Redis (TTL expiry / eviction / explicit delete), the next /agent/turn must
// **401 "invalid session"**.
//
// Fills an invalidation coverage gap: iam-revoke-blocks-next-turn tests "code gets revoked
// -> turn rejected" (the token is still there, the code is dead); this one tests "the
// **token itself** is gone -> rejected", i.e. the path where Sessions.Get fails inside
// authVisitorWithToken, which was untested before.

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
      // First turn: token valid -> 200.
      expect((await turn(request, sess)).status()).toBe(200);
      // Simulate TTL expiry / eviction: delete vsession:* from Redis.
      evictVisitorSessions();
      // Send with the same token again: Sessions.Get can't find it -> 401 "invalid session".
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
