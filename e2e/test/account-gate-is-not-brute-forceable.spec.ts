// account-gate-is-not-brute-forceable.spec.ts —— the current-password gate itself must be
// able to withstand a brute-force attempt.
//
// The defect (audited 2026-08-31): both `/api/admin/login` and `/api/admin/recover` have
// `loginGuard` attached (per-IP rate limiting + constant-time response,
// `routes/admin/claim.go:63`). But `/account/email` and `/account/password` have **neither**
// (`routes/admin/account.go:29-31`).
//
// One could argue these two sit behind a session, so an attacker needs a session first.
// **That's exactly the problem** — the whole reason the current-password gate exists is that
// "stealing a session should not equal taking over the account." But right now, whoever
// steals a session can hammer `/account/password` at full speed, unlimited attempts, with no
// rate limiting at all. There's a lock on the front door, but the combination dial on the
// safe inside can be spun freely.
//
// The criterion: not "some single attempt got rejected" — that would happen anyway. What's
// asserted is that **this path gets blocked after repeated failures**, and blocked the same
// way as the front door (the same loginGuard, not a separately written one).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const ATTEMPTS = 12;

const OWNER = {
  email: 'bruteforce@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'bruteforce',
  fullName: 'Bea Bruteforce',
};

async function guessPassword(
  request: APIRequestContext, csrf: string, guess: string,
): Promise<number> {
  const res = await request.patch(`${BACKEND}/api/admin/account/password`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: guess, new_password: 'whatever-the-attacker-wants-1' },
  });
  return res.status();
}

test.describe('account · the current-password gate is rate limited like the front door', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a stolen session cannot grind the current-password gate at full speed',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // The attacker holds a valid session — this is exactly the scenario this gate exists to prevent.
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const codes: number[] = [];
      for (let i = 0; i < ATTEMPTS; i += 1) {
        codes.push(await guessPassword(request, csrf, `guess-number-${i}`));
      }

      // The first few are 401/403 (wrong password); at some point it must turn into 429
      // (blocked by rate limiting). Assert "a 429 appeared" rather than "the last one is
      // 429" — the exact threshold is an ops tradeoff; here it's only required to exist.
      expect(codes, `12 次全速猜测一次都没被挡：${codes.join(',')}`).toContain(429);

      // And once rate-limited, **the correct password should not go through right away
      // either** — otherwise rate limiting only delays success, and the attacker still gets
      // through once they guess right.
      const afterBlock = await guessPassword(request, csrf, OWNER.password);
      expect(afterBlock).toBe(429);

      await request.dispose();
    });

  test('the same guard covers the email gate, not only the password gate',
    async ({ playwright }) => {
      // Both paths lead to the same thing (changing credentials). Blocking only one is the
      // same as blocking neither — [[gate-after-early-return-is-walkable]]: switch entry
      // points and you route around it.
      const request = await playwright.request.newContext();
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const codes: number[] = [];
      for (let i = 0; i < ATTEMPTS; i += 1) {
        const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
          headers: { 'X-Csrftoken': csrf },
          data: { current_password: `guess-number-${i}`, new_email: 'attacker@example.com' },
        });
        codes.push(res.status());
      }
      expect(codes, `email 那道闸门 12 次全速猜测没被挡：${codes.join(',')}`).toContain(429);
      await request.dispose();
    });
});
