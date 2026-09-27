// tasks-panel.spec.ts —— the admin Tasks panel (docs/design/event-bus-outbox-webhooks.md, *Admin
// "Tasks" panel*). Every assertion is on what the page shows; the API is used only to set things up.
//
// Faults are real: Meili is stopped, so `corpus.index` jobs genuinely fail and retry. Nothing is
// written into the job table by hand.
//
// Contract (red on the unchanged code — the panel does not exist yet):
//   • admin-nav-tasks opens /admin/tasks.
//   • Overview: tasks-count-<state> for pending / running / retryable / completed / discarded /
//     cancelled; tasks-oldest-pending. The counts follow the kind filter.
//   • Job list: tasks-filter-kind, tasks-filter-state; rows tasks-row with data-kind / data-state /
//     data-job-id. Clicking a row opens task-detail (data-job-id) with task-state,
//     task-attempt-error (one per failed attempt), task-next-retry, and task-retry / task-cancel.
//   • Periodic: periodic-row[data-name] with periodic-last-run (data-at = the raw run time),
//     periodic-next-run, periodic-run-now, periodic-history.
//   • Event stream: event-row[data-type][data-subject]; its detail lists event-fanout rows with
//     data-subscriber / data-state.

import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@/fixtures/test';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { restartBackend } from '@/fixtures/instance';
import { searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

interface WriteReceipt { id: string; index_job_id?: number }

function stopMeili(): void {
  execSync('make -C .. dev-stop-svc SVC=meilisearch', { stdio: 'inherit' });
}

function startMeili(): void {
  execSync('make -C .. dev-restart-svc SVC=meilisearch', { stdio: 'inherit' });
}

async function createWiki(title: string, body: string): Promise<WriteReceipt> {
  return callTool<WriteReceipt>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title, body, tags: [],
  });
}

async function openTasks(page: Page): Promise<void> {
  await gotoAdminSection(page, 'tasks');
  await expect(page.getByTestId('tasks-count-completed')).toBeVisible();
}

async function countOf(page: Page, state: string): Promise<number> {
  return Number(await page.getByTestId(`tasks-count-${state}`).innerText());
}

async function openJob(page: Page, jobID: number): Promise<void> {
  await page.locator(`[data-testid="tasks-row"][data-job-id="${jobID}"]`).click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
}

async function searchable(term: string): Promise<string[]> {
  const s = await issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
  return searchTitles(O.request, s, term);
}

async function lastRunOfFirstPeriodic(page: Page): Promise<string | null> {
  return page.locator('[data-testid="periodic-row"]').first().getByTestId('periodic-last-run').getAttribute('data-at');
}

async function overviewCounts(adminPage: Page): Promise<void> {
  stopMeili();
  await createWiki('Panel one', 'VICTORKW one');
  await createWiki('Panel two', 'VICTORKW two');
  await createWiki('Panel three', 'VICTORKW three');
  await openTasks(adminPage);
  await expect.poll(async () => {
    await adminPage.reload();
    return countOf(adminPage, 'retryable');
  }, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThanOrEqual(3);
  await expect(adminPage.getByTestId('tasks-oldest-pending')).toHaveText(/\d+\s*(s|m|h)/);
}

async function listFilters(adminPage: Page): Promise<void> {
  await openTasks(adminPage);
  await adminPage.getByTestId('tasks-filter-kind').selectOption('corpus.index');
  await adminPage.getByTestId('tasks-filter-state').selectOption('retryable');
  const rows = adminPage.getByTestId('tasks-row');
  await expect(rows.first()).toBeVisible();
  const kinds = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  const states = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
  expect(new Set(kinds)).toEqual(new Set(['corpus.index']));
  expect(new Set(states)).toEqual(new Set(['retryable']));
}

async function jobDetail(adminPage: Page): Promise<void> {
  const r = await createWiki('Panel detail', 'WHISKEYKW detail');
  await openTasks(adminPage);
  await expect.poll(async () => {
    await adminPage.reload();
    return adminPage.locator(`[data-testid="tasks-row"][data-job-id="${r.index_job_id}"]`).getAttribute('data-state');
  }, { timeout: 60_000, intervals: [2_000] }).toBe('retryable');
  await openJob(adminPage, r.index_job_id ?? 0);
  await expect(adminPage.getByTestId('task-state')).toHaveText(/retryable/i);
  await expect(adminPage.getByTestId('task-attempt-error').first()).toContainText(/meili|connect|refused|dial|no such host/i);
  await expect(adminPage.getByTestId('task-next-retry')).toHaveText(/\d/);
}

async function cancelThenRetry(adminPage: Page): Promise<void> {
  const keep = await createWiki('Panel keep', 'XRAYKW keep me');
  const drop = await createWiki('Panel drop', 'XRAYKW drop me');
  await openTasks(adminPage);
  await expect.poll(async () => {
    await adminPage.reload();
    // count() does not wait: read only once the list has rendered its rows.
    await adminPage.getByTestId('tasks-row').first().waitFor();
    return adminPage.locator(`[data-testid="tasks-row"][data-job-id="${drop.index_job_id}"]`).count();
  }, { timeout: 30_000 }).toBe(1);
  await openJob(adminPage, drop.index_job_id ?? 0);
  await adminPage.getByTestId('task-cancel').click();
  await expect(adminPage.getByTestId('task-state')).toHaveText(/cancelled/i);
  startMeili();
  await openTasks(adminPage);
  await openJob(adminPage, keep.index_job_id ?? 0);
  // Clicked right after opening, with no wait: the button must act on the row just clicked,
  // never on the detail left open from before (it did once — the cancelled job ran again).
  await adminPage.getByTestId('task-retry').click();
  await expect(adminPage.getByTestId('task-detail')).toHaveAttribute('data-job-id', String(keep.index_job_id));
  await expect(adminPage.getByTestId('task-state')).toHaveText(/completed/i, { timeout: 30_000 });
  // The side effect really happened, and the cancelled one's did not: the search result is
  // exactly the kept note — a positive equality, so an empty search cannot pass.
  await expect.poll(() => searchable('XRAYKW'), { timeout: 30_000 }).toEqual(['Panel keep']);
}

async function periodicRunNow(adminPage: Page): Promise<void> {
  await openTasks(adminPage);
  const row = adminPage.locator('[data-testid="periodic-row"]').first();
  await expect(row.getByTestId('periodic-last-run')).toHaveText(/\d/);
  await expect(row.getByTestId('periodic-next-run')).toHaveText(/\d/);
  // data-at is the raw run time (sub-second), so a new run always reads as a different value.
  const before = await lastRunOfFirstPeriodic(adminPage);
  await row.getByTestId('periodic-run-now').click();
  // The receipt of the click: the POST was sent and accepted. Once (1 in 5, 2026-09-26) the click
  // reached no backend at all — no POST, no job — and the red read "the last run did not change",
  // which cannot tell a lost click from a run that never happened. This line separates the two.
  await expect(adminPage.getByTestId('toast-success').filter({ hasText: 'Queued' }),
    'the Run now request was sent and queued').toBeVisible();
  await expect.poll(async () => {
    await adminPage.reload();
    return lastRunOfFirstPeriodic(adminPage);
  }, { timeout: 30_000 }).not.toBe(before);
}

async function periodicSurvivesRestart(adminPage: Page): Promise<void> {
  await openTasks(adminPage);
  const name = await adminPage.locator('[data-testid="periodic-row"]').first().getAttribute('data-name');
  const row = adminPage.locator(`[data-testid="periodic-row"][data-name="${name}"]`);
  const before = await row.getByTestId('periodic-last-run').getAttribute('data-at');
  expect(before, 'it ran before the restart').toBeTruthy();
  restartBackend();
  await openTasks(adminPage);
  await expect(row.getByTestId('periodic-history')).toContainText(new Date(before ?? '').toISOString().slice(0, 16));
}

async function eventStream(adminPage: Page): Promise<void> {
  const r = await createWiki('Panel event', 'YANKEEKW event');
  await callTool(O.request, O.apiToken, O.sid, 'corpus.update', {
    genre: 'wiki', id: r.id, title: 'Panel event', body: 'YANKEEKW edited', tags: [],
  });
  await openTasks(adminPage);
  const ev = adminPage.locator('[data-testid="event-row"][data-type="corpus.note.changed"][data-subject="wiki://panel-event"]').first();
  await expect(ev).toBeVisible({ timeout: 15_000 });
  await ev.click();
  const fan = adminPage.locator('[data-testid="event-fanout"][data-subscriber="corpus.index"]');
  await expect(fan).toBeVisible();
  await expect(fan).toHaveAttribute('data-state', /completed|pending|running/);
}

test.use({ ownerCredentials: { email: 'tasks@example.com', password: 'correct-horse-battery-staple' } });
test.describe('Tasks panel', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  test.beforeAll(async ({ playwright }) => { O = await setupRetrievalOwner(playwright, 'tasks'); });
  test.afterAll(async () => {
    startMeili();
    await O.request.dispose();
  });

  test('overview counts real retryable jobs and the age of the oldest pending one', ({ adminPage }) => overviewCounts(adminPage));
  test('the job list filters by kind and state, and shows only the selection', ({ adminPage }) => listFilters(adminPage));
  test('job detail shows each attempt\'s error and when it runs next', ({ adminPage }) => jobDetail(adminPage));
  test('Cancel stops a job for good; Retry now runs another to completion', ({ adminPage }) => cancelThenRetry(adminPage));
  test('periodic jobs show their last and next run, and Run now updates the last run', ({ adminPage }) => periodicRunNow(adminPage));
  test('periodic runs from before a backend restart are still shown after it', ({ adminPage }) => periodicSurvivesRestart(adminPage));
  test('the event stream shows a note edit and which subscribers it fanned out to', ({ adminPage }) => eventStream(adminPage));
});
