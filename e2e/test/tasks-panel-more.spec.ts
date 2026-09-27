// tasks-panel-more.spec.ts —— Tasks panel e2e items 9–12 of docs/design/event-bus-outbox-webhooks.md
// (*Test plan* › "Tasks panel e2e"). Items 1–8 live in tasks-panel.spec.ts.
//
// Every assertion is on what a caller can see: the admin page, the sink's inbox, an HTTP answer.
// Faults are real: the sink answers 410 (a real discard) and the job-board mock answers slowly.
//
// Contract (red on the unchanged code):
//   • Webhook delivery log: each webhook-delivery row (data-job-id) carries webhook-delivery-job, a
//     link to /admin/tasks?job=<id>; the Tasks page opens that job's task-detail[data-job-id] on load.
//   • webhook-redeliver-all delivers every discarded job of the open endpoint (the sink gets each
//     again, answered 200).
//   • tasks-alert[data-alert="jobs_discarded"] shows while a discarded job of the selected kind
//     exists, and not once it is retried to completion (tasks-count-discarded reads 0).
//   • tasks.* and events.* are owner plane only: an API key (smk_…) gets 404 block_not_enabled on
//     /api/pub/v1, 401 unauthorized on /api/admin/tasks, 401 on /mcp; the owner reads tasks.overview.
//   • jobs.fetch_new past its 20 s wait answers {job_ids, pending: true}; jobs.fetch_result answers
//     the same shape a fast jobs.fetch_new does. Admin listings shows listings-fetch-pending, then rows.
//
// events_backlog (>1000 unfanned events or one 5 minutes old) is not produced here: 1000 writes or a
// 5-minute stall do not fit a bounded e2e case. Its threshold is covered by the stats/ops UT on
// alertsOf; this spec covers the alert surface with jobs_discarded, which shares the same path.

import type { APIRequestContext, Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { execSQL } from '@/fixtures/instance';
import { jobsRegisterSource, mockSetDelay } from '@/fixtures/jobs';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { createRole } from '@/fixtures/roles';
import { accepted, awaitSink, createHook, hookDeliveries, planSink, resetSink } from '@/fixtures/webhooks';

let O: RetrievalOwner;

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const NOTE = 'corpus.note.changed';
const DELIVER = 'webhook.deliver';

async function publishedWiki(title: string): Promise<void> {
  const { id } = await callTool<{ id: string }>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title, body: 'x', tags: [],
  });
  await callTool(O.request, O.apiToken, O.sid, 'seo.set_entry_seo', { genre: 'wiki', id, published: true, excerpt: '' });
}

async function discardedJobs(endpointID: string, want: number): Promise<number[]> {
  let ids: number[] = [];
  await expect.poll(async () => {
    ids = (await hookDeliveries(O, endpointID)).filter((d) => d.state === 'discarded').map((d) => d.job_id);
    return ids.length;
  }, { timeout: 60_000, intervals: [500] }).toBe(want);
  return ids;
}

async function openLog(page: Page, endpointID: string): Promise<void> {
  await gotoAdminSection(page, 'webhooks');
  await page.locator(`[data-testid="webhook-row"][data-endpoint-id="${endpointID}"]`).getByTestId('webhook-open').click();
  await expect(page.getByTestId('webhook-delivery').first()).toBeVisible();
}

async function linkThenRedeliverAll(adminPage: Page): Promise<void> {
  const { endpoint } = await createHook(O, 'more-gone', [NOTE]);
  // The first 410 starts the endpoint's failure streak, and a streak defers NEW deliveries by the
  // cooldown. A 3 s answer keeps the first in flight while the second note fans out, so both are
  // real deliveries that the receiver refuses.
  await mockSetDelay(O.request, '/webhook-sink/more-gone', 3_000);
  await planSink(O.request, 'more-gone', { status: 410, count: 2 });
  await publishedWiki('More gone one');
  await publishedWiki('More gone two');
  const [jobID] = await discardedJobs(endpoint.id, 2);
  await mockSetDelay(O.request, '/webhook-sink/more-gone', 0);
  await openLog(adminPage, endpoint.id);
  await adminPage.locator(`[data-testid="webhook-delivery"][data-job-id="${jobID}"]`).getByTestId('webhook-delivery-job').click();
  await adminPage.waitForURL(new RegExp(`/admin/tasks\\?job=${jobID}$`));
  await expect(adminPage.getByTestId('task-detail')).toHaveAttribute('data-job-id', String(jobID));
  await expect(adminPage.getByTestId('task-state')).toHaveText(/discarded/i);
  await openLog(adminPage, endpoint.id);
  await adminPage.getByTestId('webhook-redeliver-all').click();
  const got = await awaitSink(O.request, 'more-gone', (ds) => accepted(ds).length >= 2);
  expect(accepted(got).map((d) => d.body.subject).sort()).toEqual(['wiki://more-gone-one', 'wiki://more-gone-two']);
  expect(got.map((d) => d.status).sort()).toEqual([200, 200, 410, 410]);
}

async function tasksFor(page: Page, kind: string): Promise<void> {
  await gotoAdminSection(page, 'tasks');
  await expect(page.getByTestId('tasks-count-completed')).toBeVisible();
  await page.getByTestId('tasks-filter-kind').selectOption(kind);
  await expect(page.getByTestId('tasks-filter-kind')).toHaveValue(kind);
}

async function discardedAlert(adminPage: Page): Promise<void> {
  // river_job survives resetInstance, so discarded deliveries of earlier specs (their endpoints are
  // gone, so a retry discards again) would hold this kind-scoped alert on. Start from none.
  execSQL(`DELETE FROM river_job WHERE kind = '${DELIVER}' AND state = 'discarded'`);
  const { endpoint } = await createHook(O, 'more-alert', [NOTE]);
  await planSink(O.request, 'more-alert', { status: 410, count: 1 });
  await publishedWiki('More alert');
  const [jobID] = await discardedJobs(endpoint.id, 1);
  await tasksFor(adminPage, DELIVER);
  const alert = adminPage.locator('[data-testid="tasks-alert"][data-alert="jobs_discarded"]');
  await expect(alert).toBeVisible();
  await expect(adminPage.getByTestId('tasks-count-discarded')).toHaveText('1');
  await adminPage.getByTestId('tasks-filter-state').selectOption('discarded');
  await adminPage.locator(`[data-testid="tasks-row"][data-job-id="${jobID}"]`).click();
  await expect(adminPage.getByTestId('task-detail')).toHaveAttribute('data-job-id', String(jobID));
  await adminPage.getByTestId('task-retry').click();
  await expect(adminPage.getByTestId('task-state')).toHaveText(/completed/i, { timeout: 30_000 });
  await adminPage.reload();
  await tasksFor(adminPage, DELIVER);
  await expect(adminPage.getByTestId('tasks-count-discarded')).toHaveText('0');
  await expect(alert).toHaveCount(0);
  await awaitSink(O.request, 'more-alert', (ds) => accepted(ds).some((d) => d.body.subject === 'wiki://more-alert'));
}

interface PubRefusal { reason: string; detail: string }

async function mintKey(): Promise<string> {
  const role = await createRole(O.request, O.csrf, { name: 'more-key', description: 'api key role', corpus_uris: ['wiki://**'] });
  const mint = await callTool<{ secret: string }>(O.request, O.apiToken, O.sid, 'api_keys.create', {
    label: 'more-key', assumed_role_id: role.id,
  });
  return mint.secret;
}

async function pubCall(r: APIRequestContext, key: string, method: string, tool: string): Promise<[number, PubRefusal]> {
  const res = await r.fetch(`${BACKEND}/api/pub/v1/tools/${tool}`, {
    method, headers: { Authorization: `Bearer ${key}` }, data: {},
  });
  return [res.status(), await res.json() as PubRefusal];
}

// r —— a fresh context with no owner cookie: the key is the only credential on these calls.
async function apiKeyRefused(r: APIRequestContext): Promise<void> {
  const key = await mintKey();
  const disc = await r.get(`${BACKEND}/api/pub/v1/tools`, { headers: { Authorization: `Bearer ${key}` } });
  expect(disc.status(), 'the key itself is valid').toBe(200);
  for (const [method, tool] of [['QUERY', 'tasks_overview'], ['QUERY', 'tasks_list'], ['POST', 'tasks_retry'],
    ['QUERY', 'events_list'], ['QUERY', 'events_get']] as const) {
    const [status, body] = await pubCall(r, key, method, tool);
    expect([status, body.reason], `${tool} on the API-key face`).toEqual([404, 'block_not_enabled']);
  }
  const admin = await r.get(`${BACKEND}/api/admin/tasks/overview`, { headers: { Authorization: `Bearer ${key}` } });
  expect(admin.status()).toBe(401);
  expect((await admin.json() as { error: { code: string } }).error.code).toBe('unauthorized');
  const mcp = await r.post(`${BACKEND}/mcp`, {
    headers: { Authorization: `Bearer ${key}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tasks.overview', arguments: {} } },
  });
  expect(mcp.status()).toBe(401);
  // Sentinel: the owner reads the same op, so the refusals above are about the caller, not the op.
  const ov = await callTool<{ jobs: { counts: Record<string, number> }; alerts: string[] }>(
    O.request, O.apiToken, O.sid, 'tasks.overview', {},
  );
  expect(Object.keys(ov.jobs.counts).sort()).toEqual(['cancelled', 'completed', 'discarded', 'pending', 'retryable', 'running']);
}

interface FetchAnswer { jobs?: { title: string }[]; job_ids?: number[]; pending?: boolean }

const SLOW_PREFIX = '/jsonld/';
// Three serial requests (sitemap + two postings) at 8 s each: every request is inside the 20 s
// HTTP timeout, the whole fetch is past the 20 s wait.
const SLOW_MS = 8_000;

async function listingsPendingThenRows(adminPage: Page): Promise<void> {
  await gotoAdminSection(adminPage, 'listings');
  await expect(adminPage.getByTestId('listings-fetch')).toBeEnabled({ timeout: 30_000 });
  await mockSetDelay(O.request, SLOW_PREFIX, SLOW_MS);
  await adminPage.getByTestId('listings-fetch').click();
  await expect(adminPage.getByTestId('listings-fetch-pending')).toBeVisible({ timeout: 40_000 });
  // The open's own auto-fetch (unslowed) may already have listed the rows, so they prove nothing
  // until the slowed fetch is over: wait for the pending line to go, then read the rows.
  await expect(adminPage.getByTestId('listings-fetch-pending')).toBeHidden({ timeout: 60_000 });
  await expect(adminPage.getByTestId('listings-list').getByText('Platform Engineer 1')).toBeVisible();
}

async function receiptThenSameShape(sourceID: string): Promise<void> {
  const receipt = await callTool<FetchAnswer>(O.request, O.apiToken, O.sid, 'jobs.fetch_new', { source_id: sourceID });
  expect(receipt).toEqual({ job_ids: [expect.any(Number)], pending: true });
  let late: FetchAnswer = receipt;
  await expect.poll(async () => {
    late = await callTool<FetchAnswer>(O.request, O.apiToken, O.sid, 'jobs.fetch_result', { job_ids: receipt.job_ids });
    return late.pending === true;
  }, { timeout: 60_000, intervals: [1_000] }).toBe(false);
  await mockSetDelay(O.request, SLOW_PREFIX, 0);
  const fast = await callTool<FetchAnswer>(O.request, O.apiToken, O.sid, 'jobs.fetch_new', { source_id: sourceID });
  expect(fast.pending, 'unslowed, the fetch answers within the wait').toBeUndefined();
  expect(Object.keys(late).sort()).toEqual(Object.keys(fast).sort());
  const titles = (a: FetchAnswer) => (a.jobs ?? []).map((j) => j.title).sort();
  expect(titles(late)).toEqual(['Platform Engineer 1', 'Platform Engineer 2']);
  expect(titles(late)).toEqual(titles(fast));
}

async function completionHooks(adminPage: Page): Promise<void> {
  const src = await jobsRegisterSource(O.request, O.apiToken, O.sid, {
    kind: 'jobposting_jsonld', label: 'Slow board',
    config: { sitemap: 'http://external-mock:9000/jsonld/sitemap.xml', url_filter: '/jobs/' },
  });
  await listingsPendingThenRows(adminPage);
  await mockSetDelay(O.request, SLOW_PREFIX, SLOW_MS);
  await receiptThenSameShape(src.id);
}

test.use({ ownerCredentials: { email: 'tasksmore@example.com', password: 'correct-horse-battery-staple' } });
test.describe('Tasks panel · items 9–12', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'tasksmore');
    await resetSink(O.request);
  });
  test.afterAll(async () => {
    await mockSetDelay(O.request, SLOW_PREFIX, 0);
    await mockSetDelay(O.request, '/webhook-sink/more-gone', 0);
    await O.request.dispose();
  });

  test('a delivery-log row links to its job in Tasks; Re-deliver all delivers every discarded job',
    ({ adminPage }) => linkThenRedeliverAll(adminPage));
  test('the jobs_discarded alert shows while a discarded job exists, and clears once it is retried',
    ({ adminPage }) => discardedAlert(adminPage));
  test('tasks.* and events.* are refused to an API key; the owner reads tasks.overview', async ({ playwright }) => {
    const r = await playwright.request.newContext();
    await apiKeyRefused(r);
    await r.dispose();
  });
  test('a slow fetch answers a receipt, then the same shape; admin listings shows pending then rows',
    ({ adminPage }) => completionHooks(adminPage));
});
