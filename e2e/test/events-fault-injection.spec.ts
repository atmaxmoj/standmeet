// events-fault-injection.spec.ts —— *Regression and fault injection* › Fault injection of
// docs/design/event-bus-outbox-webhooks.md, the cases not already driven elsewhere: a webhook
// endpoint that times out, one that refuses the connection, and a Postgres restart mid-flow.
// (500 / 429 / 410: webhooks.spec.ts. Backend restart + Meili down: events-index-via-bus.spec.ts.)
//
// The faults are real: the receiver really answers late (the mock holds the request), the port
// really is closed, the database container really restarts. Every case is bounded.
//
// Contract (red on the unchanged code):
//   • An endpoint slower than the delivery's HTTP timeout: the attempt fails with a timeout error and
//     the delivery turns retryable; once the receiver is fast again the retry delivers it (attempt 2),
//     and the receiver accepts it exactly once.
//   • An endpoint whose port is closed: the delivery log shows the delivery retryable with a
//     "refused" error within seconds (no hang), the endpoint row reads failing, and a later event's
//     delivery waits out the cooldown (pending, attempt 0). Discard needs 18 attempts over about
//     5 days, so it is not reached here; the retry schedule is covered by the events UTs.
//   • After `make dev-restart-svc SVC=db`, an edit still reaches the webhook receiver and search.

import { execSync } from 'node:child_process';

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { mockSetDelay } from '@/fixtures/jobs';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';
import {
  accepted, awaitSink, createHook, hookDeliveries, resetSink, type CreatedHook,
} from '@/fixtures/webhooks';

let O: RetrievalOwner;

const NOTE = 'corpus.note.changed';
const SLOW_SINK = '/webhook-sink/fi-slow';

async function publishedWiki(title: string, body: string): Promise<void> {
  const { id } = await callTool<{ id: string }>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title, body, tags: [],
  });
  await callTool(O.request, O.apiToken, O.sid, 'seo.set_entry_seo', { genre: 'wiki', id, published: true, excerpt: '' });
}

async function lastError(endpointID: string): Promise<string> {
  const d = (await hookDeliveries(O, endpointID))[0];
  return d?.errors?.at(-1)?.error ?? '';
}

async function openLog(page: Page, endpointID: string): Promise<void> {
  await gotoAdminSection(page, 'webhooks');
  await page.locator(`[data-testid="webhook-row"][data-endpoint-id="${endpointID}"]`).getByTestId('webhook-open').click();
  await expect(page.getByTestId('webhook-log')).toBeVisible();
}

async function timeoutThenDelivered(adminPage: Page): Promise<void> {
  const { endpoint } = await createHook(O, 'fi-slow', [NOTE]);
  // Past both the 10 s HTTP timeout and the 15 s job limit: the receiver never answers in time.
  await mockSetDelay(O.request, SLOW_SINK, 20_000);
  await publishedWiki('Fault slow', 'slow receiver');
  await expect.poll(() => lastError(endpoint.id), { timeout: 30_000, intervals: [500] })
    .toMatch(/timeout|deadline/i);
  // The retry comes 5 s after the failed attempt: the receiver is fast again before it.
  await mockSetDelay(O.request, SLOW_SINK, 0);
  const got = await awaitSink(O.request, 'fi-slow', (ds) => accepted(ds).length >= 1, 30_000);
  expect(got.map((d) => d.status), 'the abandoned attempt was never answered; the retry was').toEqual([200]);
  expect(got[0]?.body.subject).toBe('wiki://fault-slow');
  await openLog(adminPage, endpoint.id);
  await expect(adminPage.getByTestId('webhook-delivery').first()).toHaveAttribute('data-state', 'completed', { timeout: 10_000 });
  await expect(adminPage.getByTestId('webhook-delivery').first()).toHaveAttribute('data-attempt', '2');
}

async function refusedThenCooldown(adminPage: Page): Promise<void> {
  // external-mock is on the egress allow-list; nothing listens on 9001.
  const { endpoint } = await callTool<CreatedHook>(O.request, O.apiToken, O.sid, 'webhooks.create', {
    url: 'http://external-mock:9001/refused', event_types: [NOTE],
  });
  await publishedWiki('Fault refused', 'closed port');
  await openLog(adminPage, endpoint.id);
  const first = adminPage.locator('[data-testid="webhook-delivery"][data-state="retryable"]');
  await expect(first).toBeVisible({ timeout: 20_000 });
  await expect(first).toContainText(/refused/i);
  // Attempt 2 follows 5 s later and fails the same way; the next is 5 minutes out.
  await expect(first).toHaveAttribute('data-attempt', /^[12]$/);
  // A later event during the failure streak is not sent now: its delivery waits out the cooldown.
  // The open log re-reads itself every 3 s.
  await publishedWiki('Fault refused later', 'during the streak');
  const later = adminPage.locator('[data-testid="webhook-delivery"][data-state="pending"]');
  await expect(later).toBeVisible({ timeout: 20_000 });
  await expect(later).toHaveAttribute('data-attempt', '0');
  await adminPage.reload();
  await expect(adminPage.locator(`[data-testid="webhook-row"][data-endpoint-id="${endpoint.id}"]`))
    .toHaveAttribute('data-status', 'failing');
}

async function searchable(term: string): Promise<string[]> {
  const s = await issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
  return searchTitles(O.request, s, term);
}

async function postgresRestart(): Promise<void> {
  await createHook(O, 'fi-pg', [NOTE]);
  execSync('make -C .. dev-restart-svc SVC=db', { stdio: 'inherit', timeout: 120_000 });
  await publishedWiki('Fault after restart', 'ZULUFIKW after the restart');
  const got = await awaitSink(O.request, 'fi-pg',
    (ds) => accepted(ds).some((d) => d.body.subject === 'wiki://fault-after-restart'), 90_000);
  expect(accepted(got).map((d) => d.body.subject)).toContain('wiki://fault-after-restart');
  await expect.poll(() => searchable('ZULUFIKW'), { timeout: 90_000, intervals: [1_000] }).toEqual(['Fault after restart']);
}

test.use({ ownerCredentials: { email: 'faults@example.com', password: 'correct-horse-battery-staple' } });
test.describe('P2 · fault injection on the event bus', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'faults');
    await resetSink(O.request);
  });
  test.afterAll(async () => {
    await mockSetDelay(O.request, SLOW_SINK, 0);
    await O.request.dispose();
  });

  test('an endpoint slower than the timeout is retried, then delivered once it answers in time',
    ({ adminPage }) => timeoutThenDelivered(adminPage));
  test('a refused connection turns retryable at once, and the endpoint enters its cooldown',
    ({ adminPage }) => refusedThenCooldown(adminPage));
  test('after a Postgres restart an edit still reaches the webhook receiver and search', postgresRestart);
});
