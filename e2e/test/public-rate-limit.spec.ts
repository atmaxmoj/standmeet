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

  // ⚠️ This drives the **generic per-IP rate limiter**, so it must pick an endpoint with **no other
  // gate in front of it**.
  //
  // It used to hit `/access-requests`, but after F-G-4 that endpoint sits behind `RequestGuard` (5 per
  // 15 min, see `middleware/request_guard.go`) —— so the 5th request already 429s and the generic
  // limiter's 30th slot is **never reached**; the test went red on "request 5 should be accepted".
  // Red for the right reason: what it tests was already masked by another lock. Moved to
  // `reset-password` (policy table 20/min, with no second gate in front).
  test('the generic per-IP window trips 429 on the endpoint it actually governs',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        // The criterion is the **rate limiter**, not this endpoint's business result: the middleware
        // counts before the handler, so an invalid token (401) still takes a slot. The first LIMIT are
        // "not 429", the LIMIT+1th is "429" —— asserting on the business status code would bind this
        // test to a contract unrelated to rate limiting.
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
  // The token is fake —— this test does not care whether the reset itself succeeds, only **which
  // request number gets blocked by the rate limiter**.
  return request.post(`${BACKEND}/api/v1/account/reset-password`, {
    data: { token: `not-a-real-token-${n}`, new_password: 'correct-horse-battery-staple' },
  });
}
