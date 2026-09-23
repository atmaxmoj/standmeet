// access-request-notifies-owner.spec.ts —— TEST-FIRST (RED): "when a visitor submits an
// access request, the owner is notified by email, safely".
//
// The feature is not built yet, so this spec is expected to fail. It is a pure black-box
// specification of DESIRED BEHAVIOUR, written only against the public contract
// (POST /api/v1/access-requests), the owner-visible store (owner-MCP access_requests.list),
// and the mail mock (Mailpit) — never against how the backend happens to work.
//
// Three behaviours, each an independent test:
//
//   1. HAPPY PATH — mail connected. A submitted request lands the OWNER a notification email
//      that carries the request (requester email + message), AND the request is stored/visible
//      to the owner.
//
//   2. GRACEFUL / BEST-EFFORT — mail broken (persistent SMTP fault). A submitted request must
//      STILL succeed (201) and STILL be stored/visible to the owner. A failed notification
//      never breaks the visitor's request, and no owner mail is delivered.
//
//   3. EMAIL-BOMB DEFENSE — a rapid flood of valid submissions must NOT email the owner once
//      per submission. Owner-notification emails are throttled to a small burst cap while EVERY
//      request is still stored. Submissions are spread across distinct source IPs (X-Forwarded-For,
//      as chi.RealIP resolves it) so the submit endpoint's own per-IP anti-flood guard never
//      fires and we get enough ACCEPTED submissions to prove the email cap.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import {
  configureMailSupplier, clearMailpit, countMailpitMessages, mailpitHasNothingTo,
  waitForMailEnvelopeTo, armSMTPFault, resetSMTPFault, MAIL_FROM,
} from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'req-notify@example.com', password: 'correct-horse-battery-staple',
  handle: 'reqnotify', fullName: 'Request Notify Owner',
};

// ACCEPTED —— how many requests the bomb test gets ACCEPTED (each from its own IP, so the
// submit endpoint's per-IP anti-flood guard never fires). Chosen well above BURST_CAP so
// "capped" and "not capped" are unmistakably different outcomes.
const ACCEPTED = 15;

// BURST_CAP —— ⚠️ IMPLEMENTER DECISION POINT. The max owner-notification emails a burst of
// access-request submissions may deliver. This spec asserts the owner's inbox settles at EXACTLY
// this many notifications for ACCEPTED (15) rapid submissions. I chose 5 (the task's suggested
// ceiling). If you implement a different cap, change this constant to match — but keep it clearly
// below ACCEPTED, and DO NOT route owner-notify through the existing 30/recipient approve-mail
// throttle: the owner is a single recipient, so 15 < 30 would let every notification through and
// this defence would not exist. The submission-notify cap must be its own small burst cap.
const BURST_CAP = 5;

// SYNC-SEND REQUIREMENT (goes with the poll assertion in checkBomb): the owner-notify send +
// its burst-cap decision must happen synchronously within the submit request (best-effort:
// attempt-then-return, first BURST_CAP delivered, the rest dropped before 201 returns). Then,
// once every submit has been awaited, every notification that will ever be sent is already
// dispatched, so the inbox is already at its final value and the poll only lets Mailpit settle
// (same reasoning as mail-throttle-recipient.spec). Best-effort keeps this safe: a dead SMTP
// fails fast (see the graceful test) and never blocks the visitor.

let token = '';
let sid = '';

test.describe.configure({ timeout: 120_000 });

test.describe('access-request submission notifies the owner, safely', () => {
  // beforeEach, not beforeAll: the 3 tests share one backend process, and the owner-notify burst
  // cap is a per-owner bucket that lives for that process. Re-claiming a brand-new owner before
  // every test (resetInstance also flushes redis) gives the bomb test a full, fresh cap, so its
  // exact `.toBe(BURST_CAP)` can't be drained by the sends the earlier two tests made.
  // Tradeoff accepted: 3× claim + mail-config makes this file's run slower.
  test.beforeEach(async ({ playwright }) => { await setup(playwright); });

  test('happy path: owner gets a notification email carrying the request, and it is stored',
    ({ playwright }) => run(playwright, checkHappyPath));

  test('best-effort: mail broken → request still succeeds and is stored, no owner mail delivered',
    ({ playwright }) => run(playwright, checkGraceful));

  test('email-bomb defense: a flood stores every request but caps owner notifications',
    ({ playwright }) => run(playwright, checkBomb));

  test('no mail configured at all → request still succeeds and is stored, no owner mail delivered',
    ({ playwright }) => run(playwright, checkNoMailConfigured));
});

// setup —— one owner who can send mail, plus a long-lived owner-MCP session for the store reads.
async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  // The owner must be able to send mail for a notification to exist at all.
  await configureMailSupplier(request, OWNER.email, OWNER.password);
  // configureMailSupplier logs in again (rotating the CSRF); take a fresh session for the
  // API-token mint, then open the owner-MCP session used by every store read below.
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'req-notify');
  sid = await initMCP(request, token);
  await resetSMTPFault(request); // clear any fault a prior run left armed
  await request.dispose();
}

// run —— per-test request-context lifecycle wrapper (keeps the describe callback small).
async function run(
  playwright: Playwright, fn: (r: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext();
  try {
    await fn(request);
  } finally {
    await request.dispose();
  }
}

async function checkHappyPath(request: APIRequestContext): Promise<void> {
  await resetSMTPFault(request);
  await clearMailpit(request);

  const email = 'happy-visitor@example.com';
  const message = 'I would like access to discuss your backend work in detail.';
  const res = await submit(request, '198.51.100.1', {
    name: 'Happy Visitor', org: 'Acme Research', email, message,
  });
  expect(res.status(), 'a valid submission is accepted').toBe(201);

  // The owner is notified, and the notification carries the request itself.
  const mail = await waitForMailEnvelopeTo(request, OWNER.email);
  expect(mail.from, 'notification comes from the owner supplier from_address').toBe(MAIL_FROM);
  const body = `${mail.subject}\n${mail.text}\n${mail.html}`;
  expect(
    body.includes(email) || body.includes(message),
    'the owner notification carries the request (requester email or message text)',
  ).toBe(true);

  // The request is stored and visible to the owner.
  const reqs = await callTool<unknown[]>(request, token, sid, 'access_requests.list', {});
  expect(
    JSON.stringify(reqs),
    'the submitted request is retrievable by the owner via access_requests.list',
  ).toContain(email);
}

async function checkGraceful(request: APIRequestContext): Promise<void> {
  await clearMailpit(request);
  try {
    // Simulate "SMTP service down" for every send until reset (persistent, times omitted).
    await armSMTPFault(request, { mode: 'connection_refused' });

    const email = 'graceful-visitor@example.com';
    const res = await submit(request, '198.51.100.2', {
      name: 'Graceful Visitor', org: 'Beta Labs', email,
      message: 'Please grant me access — the mail server happens to be down right now.',
    });
    // The visitor's request must NOT be broken by a notification that cannot be sent.
    expect(
      res.status(),
      'a submission still succeeds when the owner notification cannot be delivered',
    ).toBe(201);

    // Stored despite the failed notification.
    const reqs = await callTool<unknown[]>(request, token, sid, 'access_requests.list', {});
    expect(
      JSON.stringify(reqs),
      'the request is stored even though no owner email could be delivered',
    ).toContain(email);

    // No owner mail was delivered (the send failed at the SMTP fault layer).
    expect(
      await mailpitHasNothingTo(request, OWNER.email),
      'a failed notification delivers no owner mail — it must not surface as a phantom email',
    ).toBe(true);
  } finally {
    // Critical: disarm so the bomb test can actually send.
    await resetSMTPFault(request);
  }
}

async function checkBomb(request: APIRequestContext): Promise<void> {
  await resetSMTPFault(request);
  await clearMailpit(request);

  // ACCEPTED valid submissions, each from a DISTINCT source IP so the submit endpoint's own
  // per-IP anti-flood guard never fires — every one is accepted, so the ONLY thing that can
  // bound the owner's inbox is the notification burst cap.
  const emails: string[] = [];
  for (let i = 0; i < ACCEPTED; i++) {
    const email = `bomb-${i}@example.com`;
    emails.push(email);
    const res = await submit(request, `203.0.113.${i + 1}`, {
      name: `Bomb Requester ${i}`, org: 'Botnet',
      email, message: `flood note ${i}: asking for access to talk about the audit work`,
    });
    expect(res.status(), `submission ${i} (distinct IP → not rate-limited) is accepted`).toBe(201);
  }

  // (a) Owner notifications are capped. Every submit was awaited and the notify+cap decision is
  // synchronous (see SYNC-SEND REQUIREMENT), so all sends that will ever happen are already
  // dispatched: the inbox settles at EXACTLY the cap. Only the owner receives mail here (no
  // approve, no visitor confirmation), so the Mailpit total IS the owner-notification count.
  // A broken/uncapped notify dispatched all ACCEPTED (15) sends → settles at 15 → this times
  // out red. There is no timing window that flips the result either way.
  await expect
    .poll(() => countMailpitMessages(request), {
      message: `owner notifications settle at the burst cap (${BURST_CAP}), not one per submission `
        + `(${ACCEPTED} attempted)`,
      timeout: 30_000,
    })
    .toBe(BURST_CAP);

  // (b) Every submitted request is still stored/visible to the owner — throttling drops
  // notification mail, it never drops the request itself.
  const reqs = await callTool<unknown[]>(request, token, sid, 'access_requests.list', {});
  const stored = JSON.stringify(reqs);
  for (const email of emails) {
    expect(stored, `flood request ${email} is stored despite the notification cap`).toContain(email);
  }
}

// checkNoMailConfigured —— distinct from checkGraceful: there the SMTP send fails; here there is
// NO mail supplier connected at all, so owner-notify has no channel to resolve (seamMail resolves
// to nothing). It must still behave safely. This test re-claims a BRAND-NEW owner with no mail
// supplier (discarding the beforeEach owner, which does have one) and reads that owner's store
// through its own fresh MCP session.
async function checkNoMailConfigured(request: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  // Deliberately NO configureMailSupplier: this owner cannot send mail at all.
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const noMailToken = await createAPIToken(request, csrf, 'req-notify-nomail');
  const noMailSid = await initMCP(request, noMailToken);
  await clearMailpit(request);

  const email = 'nomail-visitor@example.com';
  const res = await submit(request, '198.51.100.3', {
    name: 'NoMail Visitor', org: 'Gamma Co', email,
    message: 'Requesting access from an instance that has no mail supplier connected yet.',
  });
  // No notification channel must not break or block the visitor's request.
  expect(res.status(), 'a submission succeeds even when the owner has no mail supplier').toBe(201);

  // Stored and visible to the owner despite there being no way to notify.
  const reqs = await callTool<unknown[]>(request, noMailToken, noMailSid, 'access_requests.list', {});
  expect(
    JSON.stringify(reqs),
    'the request is stored even though no owner notification could be sent',
  ).toContain(email);

  // Nothing was delivered — with no supplier there is simply nothing to send.
  expect(
    await mailpitHasNothingTo(request, OWNER.email),
    'with no mail supplier connected, no owner notification mail is delivered',
  ).toBe(true);
}

interface RequestBody { name: string; org: string; email: string; message: string }

// submit —— POST the public access-request contract from a chosen source IP. X-Forwarded-For
// gives each submission its own per-IP rate-limit bucket (chi.RealIP resolves it), the same
// technique mail-throttle-recipient.spec uses to get past the per-IP guard.
async function submit(request: APIRequestContext, ip: string, body: RequestBody) {
  return request.post(`${BACKEND}/api/v1/access-requests`, {
    headers: { 'X-Forwarded-For': ip },
    data: body,
  });
}
