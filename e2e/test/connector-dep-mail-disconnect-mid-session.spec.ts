// connector-dep-mail-disconnect-mid-session.spec.ts —— fills the state-change matrix
// cell "mail disconnected · between two turns · smtp-dependent capability hides"
// (mid-session — mail-connector only tests the fresh gap).
//
// The smtp-dependent capability used here is owner.can_deliver_codes (the gate's
// request-access mail path relies on it), which is recomputed on every
// /api/v1/instance request — the same "hidden once Requires is unmet" rule the booking
// tool follows through its single choke-point gate. Flow: configure + verify mail →
// can_deliver_codes true (capability available) → owner disconnects mail between two
// turns → next turn can_deliver_codes **flips false** (capability gone), and the gate's
// request-access block collapses along with it.
//
// RED: before the refactor lands, if the smtp-dependent capability isn't recomputed
// per-call through the single global gate, it may still evaluate true after
// disconnect → the assertion fails, matching TDD expectations.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { configureMailConnector } from '@/fixtures/mail';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'maildep@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'maildep',
  fullName: 'Mail Dep Owner',
};

interface InstanceView { can_deliver_codes: boolean }

async function canDeliverCodes(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (res.status() !== 200) throw new Error(`instance: ${res.status()}`);
  return (await res.json() as InstanceView).can_deliver_codes;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector dep · mail disconnect between turns hides smtp-dependent capability', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('connected → can_deliver_codes true; owner disconnects mail → next turn it flips false',
    async ({ playwright, page }) => {
      const request = await playwright.request.newContext();

      // turn 1 (smtp already connected): the smtp-dependent capability is available.
      expect(await canDeliverCodes(request), 'smtp connected → capability available').toBe(true);

      // Owner disconnects the mail connector between the two turns.
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      const dis = await request.post(`${BACKEND}/api/admin/connectors/smtp/disconnect`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(dis.status()).toBe(200);

      // Next turn (re-querying the instance): Requires:[smtp] is no longer satisfied →
      // the capability disappears.
      expect(await canDeliverCodes(request), 'smtp disconnected → capability hidden').toBe(false);
      await request.dispose();

      // As soon as the capability disappears, the gate's request-access block should
      // collapse too (the visible surface stays in sync).
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /write a note/i })).toHaveCount(0);
    });
});

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await configureMailConnector(request, OWNER.email, OWNER.password); // → connected
  await request.dispose();
}
