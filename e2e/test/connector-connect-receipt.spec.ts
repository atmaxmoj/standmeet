// connector-connect-receipt.spec.ts —— when Connect says "connected", it must really have written that record.
//
// when `POST /connectors/{id}/connect` takes the non-dance path (bearer/apikey/basic), the backend calls
// `MarkConnectorConnected`, which is a bare UPDATE:
//
//     UPDATE owner_connectors SET connected_at = ... WHERE owner_id = $1 AND connector_id = $2
//
// **when the owner doesn't have this row yet, the update hits 0 rows without erroring**, so connect returns `connected: true` ——
// a lie. The card flips to connected on the spot, and the next `GET /status` says false. The owner refreshes, and the
// connection "drops on its own".
//
// when is this row missing? **every fresh install.** The row is created by the "store credentials" step, and storing credentials
// in the panel is fire-and-forget (`void adminAPI.postVoid(...)`), which doesn't block Connect —— the owner fills it in and clicks,
// and the two requests race. When the row already exists in the database (a dev box that's been run before) the order doesn't matter,
// so this only breaks on a clean database and looks "flaky". It isn't flaky, it's **a missing receipt**.
//
// the two assertions pin the two halves of this:
//   1. never stored any credentials → Connect must not say connected (if it can't write, it has to say so, and in plain words)
//   2. Connect clicked while the credentials are still in flight → it must still really connect in the end (the panel has to wait for its own write to land)
//
// both checks take **the returning `/status`**, not just the line of text on the card: the entire shape of this bug is "text right, database wrong".
// When the card's copy is asserted on its own it also uses `/^connected$/` —— `/connected/` matches even "not connected",
// which is an assertion that can never go red.

import { test, expect } from '@/fixtures/test';
import type { Page, Locator } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'receipt@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'receipt',
  fullName: 'Receipt Owner',
};

// a non-dance built-in connector: bearer auth, a single token field, store-is-connect —— it takes exactly that bare UPDATE.
const CONNECTOR_ID = 'bearer-api';
const CREDS_URL = `**/connectors/${CONNECTOR_ID}/credentials`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.configure({ mode: 'serial' });
test.describe('connector · connect writes a receipt, not a claim', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('Connect with nothing filled in never reports connected', async ({ adminPage: page }) => {
    const card = await openConnectorCard(page, CONNECTOR_ID);
    await expectNotConnected(card);

    // nothing filled in → there was never a credentials request → the row isn't in the database. Clicking Connect now:
    // that UPDATE hits 0 rows. Today the backend treats it as success and the card flips to connected —— this step is already wrong.
    await card.getByTestId('connector-connect-button').click();

    // the truth is in the database: no row = not connected. Whatever the card says doesn't count.
    await expect.poll(
      async () => (await getConnectorStatus(page, CONNECTOR_ID)).connected,
      { message: 'connect must not mark a connector connected when it stored nothing' },
    ).toBe(false);
    await expectNotConnected(card);
    // and if it can't write, it has to say so in plain words: the owner needs to know the next step, not just see a silently rolled-back state.
    await expect(card.getByTestId('connector-error')).toBeVisible();
  });

  test('Connect clicked while the credential save is still in flight still connects',
    async ({ adminPage: page }) => {
      // hold the credentials-save round trip in hand —— no timer: the gate is released explicitly by this test.
      const gate = new Gate();
      await page.route(CREDS_URL, async (route) => {
        await gate.waited;
        await route.continue();
      });

      const card = await openConnectorCard(page, CONNECTOR_ID);
      await card.getByTestId('connector-field-token').fill('static-bearer-token');
      await expectNotConnected(card);

      // the owner fills it in and clicks immediately —— the credentials-save write hasn't landed. The panel must wait for its own write,
      // rather than jumping ahead and letting the backend say "connected" against a row that doesn't exist.
      await card.getByTestId('connector-connect-button').click();
      // status leaving "not connected" = the panel has started acting (connecting… once fixed, jumping straight to
      // connected when broken). Both paths leave it, so this step won't hang the test in front of the gate.
      await expect(card.getByTestId('connector-status')).not.toHaveText(/^not connected$/i);
      gate.open();

      await expectConnected(card);
      await expect.poll(
        async () => (await getConnectorStatus(page, CONNECTOR_ID)).connected,
        { message: 'the card says connected — the database has to agree' },
      ).toBe(true);
    });

  // UX-65 —— if credentials are stored, the card has to say so, otherwise "stored but hidden" and "nothing configured" look identical.
  //
  // the backend **never returns** the credential values (connector-security verified: the credential-form returns field names,
  // not even masked values —— that's stronger than masking, and correct). The cost is that the card is left with a row of empty boxes:
  // the owner can't tell whether they configured it, and refilling once overwrites the good credentials. The fact is always there ——
  // `/status` returns `has_credentials: true` —— it just never reaches the interface.
  //
  // the assertion must give **opposite results in the two states**, otherwise an "always shown" generic hint would pass too:
  // it must be absent before storing and present after. A guard that only asserts the second half can never go red.
  test('a card with stored credentials says so, instead of showing empty boxes',
    async ({ adminPage: page }) => {
      // this runs after the two above (the describe is serial), so bearer-api has already stored credentials and connected.
      const card = await openConnectorCard(page, CONNECTOR_ID);
      await expect(
        card.getByTestId('connector-creds-stored'),
        'credentials are saved and the card must say so — empty boxes read as "nothing configured"',
      ).toBeVisible();

      // the reverse direction: on another connector that was never configured, this line must be absent.
      const untouched = await openConnectorCard(page, 'smtp');
      await expect(
        untouched.getByTestId('connector-creds-stored'),
        'a connector with no credentials must not claim to have any',
      ).toHaveCount(0);
    });
});

// Gate —— a gate released explicitly by this test (replacing sleep; timer-based waits are banned in specs).
class Gate {
  readonly waited: Promise<void>;
  private release: () => void = () => undefined;

  constructor() {
    this.waited = new Promise<void>((resolve) => { this.release = resolve; });
  }

  open(): void { this.release(); }
}

async function openConnectorCard(page: Page, id: string): Promise<Locator> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  const card = page.getByTestId(`connector-row-${id}`);
  await expect(card).toBeVisible();
  return card;
}

// expectConnected —— anchored to the whole string 'connected'. Without the anchors "not connected" matches too,
// and this assertion would never go red.
async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^connected$/i);
}

async function expectNotConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^not connected$/i);
}

interface ConnectorStatus {
  has_credentials: boolean;
  connected: boolean;
}

async function getConnectorStatus(page: Page, id: string): Promise<ConnectorStatus> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors/${id}/status`);
  if (res.status() !== 200) throw new Error(`connector status ${id}: ${res.status()}`);
  return await res.json() as ConnectorStatus;
}
