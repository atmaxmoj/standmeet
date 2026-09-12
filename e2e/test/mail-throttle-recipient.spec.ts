// mail-throttle-recipient.spec.ts —— the per-recipient outbound-mail cap holds on a REAL send flow,
// end to end (not just the unit + wiring tests).
//
// The threat it defends: an email bomb. Some outbound mail is triggered by an attacker-controlled
// address — access-request approval mails the requester the code, and the requester email is
// whatever the submitter typed. A single source IP can only submit so many requests (the public
// rate limit is 30/window), so the per-IP limit alone would seem to bound it — but a botnet spreads
// the submissions across many IPs, each under the per-IP limit, all naming the SAME victim address.
// Then the per-recipient throttle is the ONLY thing standing between the victim and an unbounded
// blast. This spec simulates exactly that: OVER_BUDGET submissions, each from a different
// X-Forwarded-For IP (chi.RealIP resolves it, so each is its own rate-limit bucket — the same
// technique security-code-bruteforce.spec uses), all to one victim, then the owner approves them
// all.
//
// The cap is the throttle's built-in default (30/recipient/hour): the owner never configures it
// (no env knob — an operator setting like this belongs in the product, and the security floor has a
// fixed sensible default). So the flow must genuinely cross 30 to be exercised.
//
// Assertions (falsifiable): the victim's inbox holds EXACTLY the budget (30), not the 31 that were
// attempted — the 31st send was dropped. AND every approve still returned success: the throttle
// skips the mail, it never fails the owner's action (a code is still issued; only the email is
// rate-limited). A broken/unwired throttle delivers all 31 → the count assertion goes red.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { configureMailSupplier, clearMailpit, countMailpitMessages } from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'mailthrottle@example.com', password: 'correct-horse-battery-staple',
  handle: 'mailthrottle', fullName: 'Mail Throttle Owner',
};
const VICTIM = 'victim@example.com';

const BUDGET = 30; // mailthrottle.defaultBudget — the per-recipient hourly cap (no env knob)
const OVER_BUDGET = BUDGET + 1; // one more than the cap, so the last one must be throttled

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 180_000 });
test.describe('the per-recipient mail cap holds against a multi-IP bomb of one victim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('over-budget approvals to one victim deliver exactly the cap; each approve still succeeds',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailSupplier(request, OWNER.email, OWNER.password);
      await clearMailpit(request);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);

      // OVER_BUDGET access-requests for the SAME victim, each from a different source IP so the
      // per-IP public rate limit (30/window) never fires — only the per-recipient cap can bound this.
      const ids: string[] = [];
      for (let i = 0; i < OVER_BUDGET; i++) {
        const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
          headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` },
          data: { name: `Requester ${i}`, org: 'Botnet', email: VICTIM, message: 'let me in' },
        });
        expect(res.status(), `submit ${i} (distinct IP → not rate-limited)`).toBe(201);
        ids.push(((await res.json()) as { id: string }).id);
      }

      // The owner approves every one — each approve issues a code and mails the victim. Even the one
      // past the cap must return success: the throttle drops the mail, it does not fail the action.
      for (let i = 0; i < ids.length; i++) {
        // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: approve must return 200 even when its mail is throttle-dropped
        const res = await request.post(
          `${BACKEND}/api/admin/access-requests/${ids[i]}/approve`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(res.status(), `approve ${i} succeeds even when its mail is throttled`).toBe(200);
      }

      // The victim's inbox: exactly the budget landed, the over-budget one was dropped. Only the
      // victim receives mail here (clearMailpit above), so the total IS the count to the victim.
      //
      // Every approve was awaited above and the throttle decision is made synchronously inside each
      // approve (drop before returning 200), so no further send will ever be dispatched — the inbox
      // is already at its final value; poll only lets mailpit's own store settle. A broken throttle
      // dispatched all 31 (also before their approves returned), so it would settle at 31 and this
      // times out red — there is no timing window that flips the result either way.
      await expect
        .poll(() => countMailpitMessages(request), {
          message: 'the victim inbox settles at exactly the per-recipient budget, not the 31 attempted',
          timeout: 30_000,
        })
        .toBe(BUDGET);

      await request.dispose();
    });
});
