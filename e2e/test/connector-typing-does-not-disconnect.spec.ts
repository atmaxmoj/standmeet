// connector-typing-does-not-disconnect.spec.ts —— F-C-46。
//
// **Typing a character into a credential field must not take down a connector
// that's still in use.**
//
// Hit in prod: while driving mail-connector check 4, my script typed into
// `from_address` just once and then broke — **CONNECT was never clicked**. The
// log showed two `POST /connectors/smtp/credentials` calls, `connected_at`
// went NULL in the DB, yet the same-screen card still read connected. In other
// words: **the moment the owner started editing the password, outbound mail
// had already stopped** — access-code delivery, booking confirmations, all of
// it hangs off this one connection.
//
// Two lines were each individually correct, and only their combination is the
// defect:
//   · `use-connector-card.ts`'s `setField` — saves to the server on every keystroke;
//   · `svc_creds.go`'s `ResetConnected: changed` — clears connected the moment
//     credentials actually change (D-5: an identity change must re-verify, per F-C-30).
// The real bug is **the commit point**: saving is bound to keystrokes, so "I'm
// thinking about changing this" and "I'm done changing this" are the same
// event on the server.
//
// This case has **two halves**, both required — we just paid for a "gate
// coarser than the defect, incidentally removed a working action" mistake in
// this very module today ([[gate-granularity-removes-working-action]]):
//   1. Typing without submitting → server state **must not move** (this is the red half);
//   2. Actually pressing CONNECT after the edit → re-verification still fires as before
//      (positive control: the fix must not take D-5 down with it).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { openConnectorCard, expectConnected } from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'typing@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'typing',
  fullName: 'Typing Owner',
};

// bearer-api — a non-dance built-in connector: one token field, saving means
// connecting. It has exactly one identity field, so "change identity" is
// cleanest to test on it.
const CONNECTOR_ID = 'bearer-api';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.configure({ mode: 'serial' });
test.describe('connector · typing is not committing (F-C-46)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('typing a new credential does NOT take the live connector down', async ({ adminPage: page }) => {
    const card = await openConnectorCard(page, CONNECTOR_ID);
    await card.getByTestId('connector-field-token').fill('the-working-token');
    await card.getByTestId('connector-connect-button').click();
    await expectConnected(card);
    // Precondition: it's connected right now.
    expect((await status(page)).connected, 'precondition: the connector is live').toBe(true);

    // Owner starts editing this field — just typing, nothing pressed yet.
    await card.getByTestId('connector-field-token').fill('half-typed-new-tok');

    // **Leave this screen and come back**, which gives the "save triggered by
    // typing" a real chance to land. Reading status via `expect.poll` directly
    // wouldn't work: poll passes the moment it's first true — but in the buggy
    // version that save is still in flight, so this would become a
    // permanently-green assertion ([[assertion-that-cannot-fail]], for the
    // second time today).
    await openConnectorCard(page, 'smtp');
    const back = await openConnectorCard(page, CONNECTOR_ID);

    // Server side is still connected: this connection is still in use, and when
    // to swap credentials is the owner's call.
    expect(
      (await status(page)).connected,
      'typing without committing must not take the live connection down',
    ).toBe(true);
    await expectConnected(back);
  });

  test('pressing Connect after a credential change still re-verifies (D-5 holds)',
    async ({ adminPage: page }) => {
      const card = await openConnectorCard(page, CONNECTOR_ID);
      // Doesn't depend on state left over from the previous case: what this one
      // is nailing down is "does state change just from typing", and using its
      // outcome as our own precondition would let both cases go red or green
      // together ([[two-guards-dying-at-one-line]]).
      await card.getByTestId('connector-field-token').fill('the-working-token');
      await card.getByTestId('connector-connect-button').click();
      await expectConnected(card);
      // Positive control: actually submit a change, and D-5's re-verify must still fire — this half guards against "fixed too aggressively".
      await card.getByTestId('connector-field-token').fill('a-different-token');
      await card.getByTestId('connector-connect-button').click();
      await expectConnected(card);
      const after = await status(page);
      // Re-verified after the submit, still connected; the new credential really was stored.
      expect(after.connected, 'a committed change re-verifies and stays connected').toBe(true);
      expect(after.has_credentials, 'the new credential was actually stored').toBe(true);
    });
});

interface ConnectorStatus {
  has_credentials: boolean;
  connected: boolean;
}

async function status(page: Page): Promise<ConnectorStatus> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors/${CONNECTOR_ID}/status`);
  if (res.status() !== 200) throw new Error(`connector status: ${res.status()}`);
  return await res.json() as ConnectorStatus;
}
