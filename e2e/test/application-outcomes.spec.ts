// application-outcomes.spec.ts —— roadmap 1.3.a/b/d: the owner records what came of an application.
//
// "Done" (roadmap): set interview, then offer → two journal rows; the detail timeline shows both; the
// list shows the outcome beside the status.
//
// Contract (fixtures/application-loop.ts, plus the UI testids fixed here):
//   - applications.update_outcome (MCP) and POST /api/admin/applications/{id}/outcome run ONE use
//     case: outcome changed + a journal row + application.outcome_changed {application_id, from, to,
//     note}, in one transaction.
//   - list row: `application-outcome-<id>` beside the status pill `application-state-<id>`;
//   - detail modal: one chip per outcome `application-outcome-set-<outcome>` (aria-pressed on the
//     current one — chips, not a <select>), and one `application-timeline-row` per journal row.
//   - an unknown outcome is refused with a message naming the outcome; nothing is written.

import { test, expect } from '@/fixtures/test';
import type { Locator, Page } from '@playwright/test';

import {
  applicationDetail, applicationRow, commitApplication, setOutcomeAdmin, setupLoopOwner, updateOutcome,
  type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { callToolOutcome } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { awaitSink, createHook, resetSink, type SinkDelivery } from '@/fixtures/webhooks';

const HANDLE = 'appoutcomes';
const SINK = 'app-outcomes';
const PASSWORD = 'correct-horse-battery-staple';

let o: LoopOwner;
let app: Committed;

test.use({ ownerCredentials: { email: `${HANDLE}@example.com`, password: PASSWORD } });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupLoopOwner(playwright, HANDLE);
  await resetSink(o.request);
  await createHook(o, SINK, ['application.outcome_changed']);
  app = await commitApplication(o);
});
test.afterAll(async () => { await o.request.dispose(); });

function changes(ds: SinkDelivery[]): SinkDelivery[] {
  return ds.filter((d) => d.body.type === 'application.outcome_changed'
    && d.body.data['application_id'] === app.applicationID);
}

test('interview then offer: two journal rows in order, the list shows offer, one event each', async () => {
  const fresh = await applicationRow(o, app.applicationID);
  expect(fresh.outcome, 'a committed application has no outcome yet').toBe('none');

  await updateOutcome(o, app.applicationID, 'interview', 'phone screen booked');
  const back = await updateOutcome(o, app.applicationID, 'offer', 'verbal offer');
  expect(back.outcome, 'the receipt is the new outcome').toBe('offer');

  const detail = await applicationDetail(o, app.applicationID);
  expect(detail.outcomes.map((r) => [r.from_outcome, r.to_outcome, r.note])).toEqual([
    ['none', 'interview', 'phone screen booked'],
    ['interview', 'offer', 'verbal offer'],
  ]);
  expect((await applicationRow(o, app.applicationID)).outcome).toBe('offer');

  const got = changes(await awaitSink(o.request, SINK, (ds) => changes(ds).length >= 2));
  expect(got.map((d) => d.body.data)).toEqual([
    { application_id: app.applicationID, from: 'none', to: 'interview', note: 'phone screen booked' },
    { application_id: app.applicationID, from: 'interview', to: 'offer', note: 'verbal offer' },
  ]);
});

test('the admin path runs the same use case: one more journal row and one more event', async () => {
  await setOutcomeAdmin(o, app.applicationID, 'hired', 'signed');
  const detail = await applicationDetail(o, app.applicationID);
  expect(detail.outcomes.length, 'one row per change, whichever face made it').toBe(3);
  expect(detail.outcomes[2]).toMatchObject({ from_outcome: 'offer', to_outcome: 'hired', note: 'signed' });
  await awaitSink(o.request, SINK, (ds) => changes(ds).some((d) => d.body.data['to'] === 'hired'));
});

test('an unknown outcome is refused by name and writes nothing', async () => {
  const before = (await applicationDetail(o, app.applicationID)).outcomes.length;
  const out = await callToolOutcome(o.request, o.apiToken, o.sid, 'applications.update_outcome',
    { application_id: app.applicationID, outcome: 'ghosted', note: '' });
  expect(out.isError, 'refused').toBe(true);
  expect(out.text, 'the refusal names what is wrong').toMatch(/outcome/i);
  expect(out.text, 'no stack trace').not.toMatch(/panic|goroutine|\.go:\d+/);
  const after = await applicationDetail(o, app.applicationID);
  expect(after.outcomes.length, 'nothing written').toBe(before);
  expect(after.outcome, 'the outcome did not move').toBe('hired');
});

async function openApplication(page: Page): Promise<Locator> {
  await page.getByTestId(`application-row-${app.applicationID}`).getByRole('button').first().click();
  const modal = page.getByTestId('application-detail-modal');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

test('admin UI: the outcome sits beside the status; the modal changes it and the timeline keeps it',
  async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'applications');
    const row = page.getByTestId(`application-row-${app.applicationID}`);
    await expect(row.getByTestId(`application-state-${app.applicationID}`), 'presence: the status pill').toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId(`application-outcome-${app.applicationID}`)).toContainText(/hired/i);

    let modal = await openApplication(page);
    await expect(modal.getByTestId('application-outcome-set-hired')).toHaveAttribute('aria-pressed', 'true');
    await modal.getByTestId('application-outcome-set-rejected').click();
    await expect(modal.getByTestId('application-outcome-set-rejected')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    await modal.getByTestId('application-detail-close').click();
    await page.reload();
    await expect(page.getByTestId(`application-outcome-${app.applicationID}`), 'kept after a reload').toContainText(/rejected/i, { timeout: 15_000 });
    modal = await openApplication(page);
    const rows = modal.getByTestId('application-timeline-row');
    await expect(rows, 'one timeline row per journal row').toHaveCount(4);
    await expect(rows.last()).toContainText(/rejected/i);
    expect((await applicationRow(o, app.applicationID)).outcome, 'receipt: stored').toBe('rejected');
  });
