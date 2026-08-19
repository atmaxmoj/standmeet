// public-rate-limit.spec.ts —— per-IP fixed-window rate limiting on the public
// abuse surface (#58-1). access-requests is capped at 30/min/IP; the 31st from
// the same IP must come back 429 rate_limited. claimFreshOwner resets the
// instance (flushes Redis), so the window counter starts clean.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const LIMIT = 20; // matches publicRatePolicy["POST /api/v1/account/reset-password"]

const OWNER = {
  email: 'ratelimit@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ratelimit',
  fullName: 'Rate Limit Owner',
};

test.describe('public rate limiting', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  // ⚠️ 这条驱的是**通用 per-IP 限流**，所以它得挑一个**前面没有别的闸**的端点。
  //
  // 以前它打 `/access-requests`，而 F-G-4 之后那个口子前面压着 `RequestGuard`（5 次 /15 分钟，
  // 见 `middleware/request_guard.go`）—— 于是第 5 条就 429，通用限流的 30 那一格**永远走不到**，
  // 用例红在「request 5 should be accepted」。红得对：它测的东西已经被另一把锁遮住了。
  // 换到 `reset-password`（策略表 20/min，前面没有第二把闸）。
  test('the generic per-IP window trips 429 on the endpoint it actually governs',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        // 判据是**限流器**，不是这个端点的业务结果：中间件在 handler 之前计数，所以
        // 令牌无效（401）照样占一格。前 LIMIT 个「不是 429」，第 LIMIT+1 个「是 429」——
        // 断在业务状态码上会把这条用例绑死在一个跟限流无关的契约上。
        for (let i = 0; i < LIMIT; i++) {
          const res = await submit(request, i);
          expect(res, `request ${i} 不该被限流挡住`).not.toBe(429);
        }
        // The next one over the cap is rejected with 429.
        const over = await submitRaw(request, LIMIT);
        expect(over.status()).toBe(429);
        const body = await over.json() as { error?: { code?: string } };
        expect(body.error?.code).toBe('rate_limited');
      } finally {
        await request.dispose();
      }
    });
});

async function submit(request: APIRequestContext, n: number): Promise<number> {
  return (await submitRaw(request, n)).status();
}

async function submitRaw(request: APIRequestContext, n: number) {
  // 令牌是假的 —— 这条用例不关心重置本身成不成，只关心**第几个请求被限流挡下**。
  return request.post(`${BACKEND}/api/v1/account/reset-password`, {
    data: { token: `not-a-real-token-${n}`, new_password: 'correct-horse-battery-staple' },
  });
}
