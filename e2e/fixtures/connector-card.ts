// connector-card.ts —— the generic driver for a card on /admin/connectors:
// locate it, fill oauth2 credentials, tick scopes, assert connection status, and
// read the mock OAuth provider's records.
//
// These helpers originally lived in `connector-connect-flow.spec.ts`. When a
// second spec needed the same actions, copying them was the easiest thing to do
// and also exactly what lets two sets of criteria drift apart —— so they moved
// into fixtures/, shared by both specs (and incidentally brought that file back
// under the line-count gate).

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

/**
 * activateConnector —— set a connector as the active one for its category slot
 * (one active per category; connecting doesn't auto-preempt).
 *
 * Waits until activation is confirmed in `GET /connectors` before returning ——
 * the booker resolves by the active slot, which rules out the "activate then
 * immediately book" race.
 */
export async function activateConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/connectors/${id}/activate`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (res.status() !== 200) throw new Error(`activate ${id}: ${res.status()}`);
  await expect.poll(async () => {
    const list = await request.get(`${BACKEND}/api/admin/connectors`);
    if (list.status() !== 200) return false;
    const rows = (await list.json() as { connectors?: { id: string; active?: boolean }[] })
      .connectors ?? [];
    return rows.find((c) => c.id === id)?.active === true;
  }, { timeout: 10_000 }).toBe(true);
}

/** openConnectorCard —— click into the connectors section from the sidebar and
 *  locate a connector's card (without page.goto). */
export async function openConnectorCard(page: Page, id: string): Promise<Locator> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  const card = page.getByTestId(`connector-row-${id}`);
  await expect(card).toBeVisible();
  return card;
}

/**
 * ensureDisconnected —— if the card is currently connected, click the UI's
 * disconnect to bring it back to disconnected. Idempotent: when not connected the
 * button isn't there, so it just returns.
 */
export async function ensureDisconnected(card: Locator): Promise<void> {
  const btn = card.getByTestId('connector-disconnect-button');
  await (await btn.count() > 0 ? btn.click() : Promise.resolve());
}

/** fillOAuth2Creds —— derived form: oauth2 → client_id + client_secret; token is
 *  left blank (the dance fetches it automatically). */
export async function fillOAuth2Creds(
  card: Locator, clientId: string, clientSecret: string,
): Promise<void> {
  await card.getByTestId('connector-field-client_id').fill(clientId);
  await card.getByTestId('connector-field-client_secret').fill(clientSecret);
}

/** selectScope —— check/uncheck one scope in the connector's derived form. */
export async function selectScope(
  card: Locator, scope: string, checked: boolean,
): Promise<void> {
  const box = card.getByTestId(`connector-scope-${scope}`);
  if (checked) await box.check();
  else await box.uncheck();
}

/**
 * expectConnected —— anchor to the **whole string** 'connected'. It was
 * originally /connected|已连接/i, but toHaveText's regex without anchors is a
 * substring match —— "not connected" matches too. That's an assertion that can
 * never go red: it passes a disconnected card just the same.
 */
export async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^(connected|已连接)$/i);
}

/** resetMockOAuthRecord —— clear the authorize/token records kept by the mock OAuth provider. */
export async function resetMockOAuthRecord(page: Page): Promise<void> {
  const res = await page.request.get(`${MOCK}/__mock/oauth/reset`);
  if (res.status() !== 200) throw new Error(`reset mock oauth record: ${res.status()}`);
}
