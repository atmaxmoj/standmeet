// supplier-dep-mail-disconnect-mid-session.spec.ts —— fills the state-change matrix
// cell "mail disconnected · between two turns · smtp-dependent block hides"
// (mid-session — mail-supplier only tests the fresh gap).
//
// The smtp-dependent block used here is owner.can_deliver_codes (the gate's
// request-access mail path relies on it), which is recomputed on every
// /api/v1/instance request — the same "hidden once Requires is unmet" rule the booking
// tool follows through its single choke-point gate. Flow: configure + verify mail →
// can_deliver_codes true (block available) → owner disconnects mail between two
// turns → next turn can_deliver_codes **flips false** (block gone), and the gate's
// request-access block collapses along with it.
//
// RED: before the refactor lands, if the smtp-dependent block isn't recomputed
// per-call through the single global gate, it may still evaluate true after
// disconnect → the assertion fails, matching TDD expectations.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { configureMailSupplier } from '@/fixtures/mail';
import { disconnectSupplier } from '@/fixtures/supplier-agent-rig';
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

test.describe('supplier dep · mail disconnect between turns hides smtp-dependent block', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('connected → can_deliver_codes true; owner disconnects mail → next turn it flips false',
    async ({ playwright, page }) => {
      const request = await playwright.request.newContext();

      // turn 1 (smtp already connected): the smtp-dependent block is available.
      expect(await canDeliverCodes(request), 'smtp connected → block available').toBe(true);

      // Owner disconnects the mail supplier between the two turns.
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await disconnectSupplier(request, csrf, 'smtp');

      // Next turn (re-querying the instance): Requires:[smtp] is no longer satisfied →
      // the block disappears.
      expect(await canDeliverCodes(request), 'smtp disconnected → block hidden').toBe(false);
      await request.dispose();

      // As soon as the block disappears, the gate's request-access block should
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
  await configureMailSupplier(request, OWNER.email, OWNER.password); // → connected
  await request.dispose();
}
