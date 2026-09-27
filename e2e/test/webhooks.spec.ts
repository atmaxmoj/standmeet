// webhooks.spec.ts —— Phase 2 acceptance of docs/design/event-bus-outbox-webhooks.md: signed, thin,
// scoped webhooks with retries and a delivery log.
//
// Contract (red on the unchanged code):
//   • admin-nav-webhooks opens /admin/webhooks (Integrations group).
//   • Create form: webhook-url (text), one webhook-event-type checkbox per exposed type
//     (data-type="corpus.note.changed" …), webhook-create. After create, webhook-secret shows the
//     secret once (whsec_…).
//   • Endpoint rows: webhook-row[data-endpoint-id]; per row webhook-send-test, webhook-open.
//   • Delivery log (after webhook-open): webhook-delivery rows with data-state and data-attempt;
//     webhook-redeliver-all re-delivers every discarded delivery of the endpoint.
//   • The same ops on the owner MCP face: webhooks.create → {endpoint, secret}; webhooks.update
//     {id, enabled}; webhooks.rotate_secret → {secret}; webhooks.deliveries → {deliveries:[…]}.
//   • Payload: thin. {id, type, subject, occurred_at, data}; subject is the entry's URI.
//   • Standard Webhooks headers: webhook-id (= event id), webhook-timestamp, webhook-signature.

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import {
  accepted, createHook, hookDeliveries, planSink, received, resetSink, rotateHookSecret,
  setHookEnabled, sinkURL, tryCreateHook, verifySignature, type SinkDelivery,
} from '@/fixtures/webhooks';

let O: RetrievalOwner;

const NOTE = 'corpus.note.changed';

async function wiki(title: string, body: string, published: boolean): Promise<string> {
  const { id } = await callTool<{ id: string }>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title, body, tags: [],
  });
  if (published) {
    await callTool(O.request, O.apiToken, O.sid, 'seo.set_entry_seo', { genre: 'wiki', id, published: true, excerpt: '' });
  }
  return id;
}

async function editWiki(id: string, title: string, body: string): Promise<void> {
  await callTool(O.request, O.apiToken, O.sid, 'corpus.update', { genre: 'wiki', id, title, body, tags: [] });
}

async function until(sink: string, pred: (d: SinkDelivery[]) => boolean, timeout = 60_000): Promise<SinkDelivery[]> {
  let got: SinkDelivery[] = [];
  await expect.poll(async () => { got = await received(O.request, sink); return pred(got); }, { timeout, intervals: [500] }).toBe(true);
  return got;
}

function subjects(ds: SinkDelivery[]): string[] {
  return accepted(ds).filter((d) => d.body.type === NOTE).map((d) => d.body.subject);
}

async function completedAttempt(id: string): Promise<number | undefined> {
  return (await hookDeliveries(O, id)).find((x) => x.state === 'completed')?.attempt;
}

async function signedInAdmin(adminPage: Page): Promise<void> {
  await gotoAdminSection(adminPage, 'webhooks');
  await adminPage.getByTestId('webhook-url').fill(sinkURL('ui'));
  await adminPage.locator(`[data-testid="webhook-event-type"][data-type="${NOTE}"]`).check();
  await adminPage.getByTestId('webhook-create').click();
  const secret = (await adminPage.getByTestId('webhook-secret').innerText()).trim();
  expect(secret).toMatch(/^whsec_/);
  const id = await wiki('Hook signed', 'first body', true);
  await editWiki(id, 'Hook signed', 'second body');
  const got = await until('ui', (ds) => subjects(ds).includes('wiki://hook-signed'));
  const d = accepted(got).find((x) => x.body.subject === 'wiki://hook-signed') as SinkDelivery;
  expect(d.body.type).toBe(NOTE);
  expect(d.headers['Webhook-Id'], 'webhook-id is the event id').toBe(d.body.id);
  expect(verifySignature(d, secret), 'signature verifies with the secret shown at creation').toBe(true);
  expect(Object.keys(d.body.data), 'thin: no body, no title').toEqual(expect.not.arrayContaining(['body', 'title']));
}

async function publishedSliceOnly(): Promise<void> {
  await createHook(O, 'scope', [NOTE]);
  const inside = await wiki('Scope inside', 'x', true);
  await wiki('Scope outside', 'x', false);
  await editWiki(inside, 'Scope inside', 'y');
  await wiki('Scope sentinel', 'x', true);
  const got = await until('scope', (ds) => subjects(ds).includes('wiki://scope-sentinel'));
  expect([...new Set(subjects(got))]).toEqual(['wiki://scope-inside', 'wiki://scope-sentinel']);
}

async function rawNeverLeaves(): Promise<void> {
  await createHook(O, 'raw', [NOTE]);
  await callTool(O.request, O.apiToken, O.sid, 'corpus.create', { genre: 'raw', body: 'private dump', tags: [] });
  await wiki('Raw sentinel', 'x', true);
  const got = await until('raw', (ds) => subjects(ds).includes('wiki://raw-sentinel'));
  expect([...new Set(subjects(got))]).toEqual(['wiki://raw-sentinel']);
}

async function retriedToThirdAttempt(): Promise<void> {
  const { endpoint } = await createHook(O, 'flaky', [NOTE]);
  await planSink(O.request, 'flaky', { status: 500, count: 2 });
  await wiki('Flaky target', 'x', true);
  const got = await until('flaky', (ds) => accepted(ds).length >= 1, 400_000);
  expect(got.map((d) => d.status)).toEqual([500, 500, 200]);
  expect(accepted(got)).toHaveLength(1);
  await expect.poll(() => completedAttempt(endpoint.id)).toBe(3);
}

async function retryAfterHonoured(): Promise<void> {
  const { endpoint } = await createHook(O, 'limited', [NOTE]);
  await planSink(O.request, 'limited', { status: 429, count: 1, retry_after: '2' });
  await wiki('Limited target', 'x', true);
  const got = await until('limited', (ds) => accepted(ds).length >= 1);
  expect(got.map((d) => d.status)).toEqual([429, 200]);
  const gap = Date.parse(got[1]?.at ?? '') - Date.parse(got[0]?.at ?? '');
  expect(gap, 'waited the Retry-After').toBeGreaterThanOrEqual(1_900);
  await expect.poll(() => completedAttempt(endpoint.id)).toBe(1);
}

async function goneThenRedelivered(adminPage: Page): Promise<void> {
  const { endpoint } = await createHook(O, 'gone', [NOTE]);
  await planSink(O.request, 'gone', { status: 410, count: 1 });
  await wiki('Gone target', 'x', true);
  await expect.poll(async () => (await hookDeliveries(O, endpoint.id)).map((x) => x.state)).toContain('discarded');
  expect((await received(O.request, 'gone')).map((d) => d.status)).toEqual([410]);
  await gotoAdminSection(adminPage, 'webhooks');
  await adminPage.locator(`[data-testid="webhook-row"][data-endpoint-id="${endpoint.id}"]`).getByTestId('webhook-open').click();
  await expect(adminPage.locator('[data-testid="webhook-delivery"][data-state="discarded"]').first()).toBeVisible();
  await adminPage.getByTestId('webhook-redeliver-all').click();
  const got = await until('gone', (ds) => accepted(ds).length >= 1);
  expect(got.map((d) => d.status)).toEqual([410, 200]);
}

async function sendTest(adminPage: Page): Promise<void> {
  const { endpoint } = await createHook(O, 'ping', [NOTE]);
  await gotoAdminSection(adminPage, 'webhooks');
  await adminPage.locator(`[data-testid="webhook-row"][data-endpoint-id="${endpoint.id}"]`).getByTestId('webhook-send-test').click();
  const got = await until('ping', (ds) => accepted(ds).some((d) => d.body.type === 'webhook.test'));
  expect(accepted(got).map((d) => d.body.type)).toContain('webhook.test');
}

async function rotatedSecret(): Promise<void> {
  const { endpoint, secret: oldSecret } = await createHook(O, 'rotate', [NOTE]);
  const secret = await rotateHookSecret(O, endpoint.id);
  expect(secret).not.toBe(oldSecret);
  await wiki('Rotate target', 'x', true);
  const got = await until('rotate', (ds) => accepted(ds).length >= 1);
  const d = accepted(got)[0] as SinkDelivery;
  expect(verifySignature(d, secret)).toBe(true);
  expect(verifySignature(d, oldSecret)).toBe(false);
}

async function disabledReceivesNothing(): Promise<void> {
  const off = await createHook(O, 'off', [NOTE]);
  await createHook(O, 'on', [NOTE]);
  await setHookEnabled(O, off.endpoint.id, false);
  await wiki('Disabled target', 'x', true);
  await until('on', (ds) => subjects(ds).includes('wiki://disabled-target'));
  expect(await received(O.request, 'off')).toEqual([]);
}

async function privateAddressRefused(): Promise<void> {
  const out = await tryCreateHook(O, 'http://127.0.0.1:8000/whatever');
  expect(out.isError).toBe(true);
  expect(out.text).toMatch(/private|internal|not allowed/i);
}

test.use({ ownerCredentials: { email: 'hooks@example.com', password: 'correct-horse-battery-staple' } });
test.describe('P2 · webhooks', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'hooks');
    await resetSink(O.request);
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('an endpoint created in admin receives a signed corpus.note.changed for a published edit',
    ({ adminPage }) => signedInAdmin(adminPage));
  test('scope: a standalone endpoint gets the published slice only (sentinel form)', publishedSliceOnly);
  test('raw never leaves the instance', rawNeverLeaves);
  test('500 twice, then success: the delivery log shows attempt 3 and the event arrives once', async () => {
    test.setTimeout(420_000); // the real Svix schedule: attempt 3 comes 5 s + 5 min after the first
    await retriedToThirdAttempt();
  });
  test('429 with Retry-After is retried later without spending an attempt', retryAfterHonoured);
  test('410 Gone is discarded at once, and Re-deliver all sends it after the receiver is fixed',
    ({ adminPage }) => goneThenRedelivered(adminPage));
  test('send test delivers webhook.test', ({ adminPage }) => sendTest(adminPage));
  test('rotating the secret: later deliveries verify with the new secret, not the old', rotatedSecret);
  test('a disabled endpoint receives nothing while an enabled one does (sentinel)', disabledReceivesNothing);
  test('an endpoint pointing at a private address is refused', privateAddressRefused);
});
