// mail-throttle-visitor-tools.spec.ts —— the per-recipient mail cap also holds for mail a VISITOR
// sends through a block (send_email), not only for mail the host sends itself.
//
// docs/design/email-recipient-throttle.md (Q4) puts the cap at "the one outbound convergence point"
// so "no path can bypass it". mail-throttle-recipient.spec proves it for host-sent mail (approvals).
// A visitor tool is a second path: send_email reaches the owner's mail supplier through the
// supplier.invoke host op, and its recipient is whatever the visitor names. Called directly on the
// tool route (no LLM in the loop), it is the cheapest bomb there is: one code, one victim, a loop.
//
// Falsifiable: BUDGET + 1 sends to one victim deliver exactly BUDGET to that victim (the last is
// refused with a readable "try again later"), and a different recipient is still delivered
// afterwards — the cap is per recipient, not a broken mail path.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { callSessionTool } from '@/fixtures/blocks';
import { createBundle } from '@/fixtures/bundles';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { clearMailpit, configureMailSupplier, countMailpitMessages, waitForMailTo } from '@/fixtures/mail';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'mailthrottle-tools@example.com', password: 'correct-horse-battery-staple',
  handle: 'mailthrottletools', fullName: 'Mail Throttle Tools Owner',
};
const VICTIM = 'victim-tools@example.com';
const BYSTANDER = 'bystander-tools@example.com';
const BUDGET = 30; // mailthrottle.defaultBudget — the per-recipient hourly cap (no env knob)

test.describe.configure({ timeout: 600_000 }); // 32 sandboxed sends, each a cold start

test('a visitor looping send_email at one address is capped per recipient', async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await configureMailSupplier(request, OWNER.email, OWNER.password);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // mail.send is role_granted: the code's role grants the block, its bundle carries it.
  const bundle = await createBundle(request, csrf, 'mail-tools', ['mail.send']);
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: ['mail.send'], bundle_id: bundle.id });
  const session = await issueSession(request, { handle: OWNER.handle, code: code.code, visitor_name: 'Mallory' });
  await clearMailpit(request);

  const results: Record<string, unknown>[] = [];
  for (let i = 0; i <= BUDGET; i++) {
    results.push(await callSessionTool(request, session, 'send_email', {
      recipient: VICTIM, subject: `spam ${i}`, body: 'unsolicited',
    }));
  }

  await expect.poll(() => countMailpitMessages(request), { timeout: 30_000 }).toBe(BUDGET);
  const last = JSON.stringify(results[BUDGET]);
  expect(last, 'the over-budget send is refused, not delivered').toMatch(/"ok":false/);
  expect(last, 'and says when to retry, in words').toMatch(/try again later/i);

  // Per recipient: another address still gets its mail.
  await callSessionTool(request, session, 'send_email', {
    recipient: BYSTANDER, subject: 'normal', body: 'hello',
  });
  expect(await waitForMailTo(request, BYSTANDER)).toContain('hello');
  await request.dispose();
});
