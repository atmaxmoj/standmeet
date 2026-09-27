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
// attempted — the 31st mail waits for the next window. AND every approve still returned success:
// the throttle holds the mail back, it never fails the owner's action (a code is still issued;
// only the email is rate-limited). A broken/unwired throttle delivers all 31 → the count assertion
// goes red.

import type { APIRequestContext } from '@playwright/test';

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
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const notifyAnchor = await lastJob(request, 'owner.notify');

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
      // The owner's own notifications for these submissions are durable jobs that run after 201:
      // clear the inbox once they have all run, so only the victim's mail is counted below.
      await waitForJobs(request, 'owner.notify', notifyAnchor, (jobs) =>
        jobs.length === OVER_BUDGET && jobs.every((j) => j.state === 'completed'));
      await clearMailpit(request);
      const approvalAnchor = await lastJob(request, 'access_request.approval_mail');

      // The owner approves every one — each approve issues a code and mails the victim. Even the one
      // past the cap must return success: the throttle holds the mail back, it does not fail the action.
      for (let i = 0; i < ids.length; i++) {
        // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: approve must return 200 even when its mail is throttled
        const res = await request.post(
          `${BACKEND}/api/admin/access-requests/${ids[i]}/approve`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(res.status(), `approve ${i} succeeds even when its mail is throttled`).toBe(200);
      }

      // The victim's inbox: exactly the budget landed, the over-budget one did not. Only the
      // victim receives mail here (clearMailpit above), so the total IS the count to the victim.
      //
      // Each approval mail is a durable job; the throttle sits in front of the send and a job over
      // the cap snoozes until the window ends (an hour) instead of sending. So the count is read
      // once every approval job has either completed or been snoozed past the next minute: no
      // further send will happen within the test. A broken throttle completed all 31 by then, so
      // this settles at 31 and times out red — there is no timing window that flips the result.
      await waitForJobs(request, 'access_request.approval_mail', approvalAnchor, (jobs) =>
        jobs.length === OVER_BUDGET && jobs.every(doneOrSnoozed));
      await expect
        .poll(() => countMailpitMessages(request), {
          message: 'the victim inbox settles at exactly the per-recipient budget, not the 31 attempted',
          timeout: 30_000,
        })
        .toBe(BUDGET);

      await request.dispose();
    });
});

interface Job { id: number; state: string; scheduled_at: string }

// jobsOf —— the jobs of one kind, newest first (the admin Tasks list).
async function jobsOf(request: APIRequestContext, kind: string): Promise<Job[]> {
  const res = await request.get(`${BACKEND}/api/admin/tasks?kind=${kind}&limit=100`);
  expect(res.status(), `tasks list for ${kind}`).toBe(200);
  return ((await res.json()) as { jobs: Job[] }).jobs;
}

// lastJob —— the newest job id of a kind before the test acts (0 = none).
async function lastJob(request: APIRequestContext, kind: string): Promise<number> {
  return (await jobsOf(request, kind))[0]?.id ?? 0;
}

// waitForJobs —— waits until the jobs of `kind` after `anchor` satisfy `done`.
async function waitForJobs(
  request: APIRequestContext, kind: string, anchor: number, done: (jobs: Job[]) => boolean,
): Promise<void> {
  await expect
    .poll(async () => done((await jobsOf(request, kind)).filter((j) => j.id > anchor)), {
      message: `${kind} jobs after ${anchor} finish`, timeout: 90_000,
    })
    .toBe(true);
}

// doneOrSnoozed —— completed, or waiting to run more than a minute from now (a throttle snooze).
function doneOrSnoozed(j: Job): boolean {
  return j.state === 'completed'
    || (j.state === 'pending' && Date.parse(j.scheduled_at) > Date.now() + 60_000);
}
