// public-rate-limit.spec.ts —— per-IP fixed-window rate limiting on the public
// abuse surface (#58-1). access-requests is capped at 30/min/IP; the 31st from
// the same IP must come back 429 rate_limited. claimFreshOwner resets the
// instance (flushes Redis), so the window counter starts clean.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const LIMIT = 30; // matches publicRatePolicy["POST /api/v1/access-requests"]

const OWNER = {
  email: 'ratelimit@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ratelimit',
  fullName: 'Rate Limit Owner',
};

test.describe('public rate limiting', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('access-requests trips 429 after the per-IP window cap',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        // First LIMIT requests are accepted (201 Created).
        for (let i = 0; i < LIMIT; i++) {
          const res = await submit(request, i);
          expect(res, `request ${i} should be accepted`).toBe(201);
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
  return request.post(`${BACKEND}/api/v1/access-requests`, {
    data: {
      name: `Requester ${n}`,
      org: 'Load Test',
      email: `load${n}@example.com`,
      message: 'I would like access to read more about your work and projects.',
    },
  });
}
