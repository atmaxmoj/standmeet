// application-followups.spec.ts —— roadmap 3.1: I am reminded to follow up, once.
//
// "Done" (roadmap): a backdated unopened application is announced once across two job runs; an
// opened one is never nudged blind; after two nudges it is "cold"; the cadence follows the outcome.
//
// Contract (docs/design/job-loop-after-apply.md, Phase 3):
//   - applications.next_followup_at is set at commit (+7 days). The periodic task `application
//     followups` (tasks.run_periodic) records application.followup_due {application_id, code_id,
//     nudge} for each due row and moves its next_followup_at forward in the same transaction, so a
//     second run announces nothing new.
//   - Due: next_followup_at passed, fewer than two nudges, and not (opened with no outcome).
//   - Cadence: none +7 days per nudge; responded +3 days; interview +1 day, then +30 days.
//     Offer, rejected, hired, withdrawn: none.
//   - applications.followups_due {} → {due: [{application_id, company, role, nudges}]}; an
//     application with two nudges and no outcome reads `followup: 'cold'` on its row; a due one
//     reads 'due' (admin: `application-followup-<id>`).
// The clock is not knobbed: the spec winds next_followup_at back with SQL.

import { test, expect } from '@/fixtures/test';

import {
  applicationRow, commitApplication, setupLoopOwner, updateOutcome, type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { execSQL, querySQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';
import { createHook, received, accepted, resetSink, type SinkDelivery } from '@/fixtures/webhooks';

const SINK = 'app-followups';

let o: LoopOwner;
let silent: Committed;
let opened: Committed;
// witness —— another unopened application, due in the same runs: its announcement is the presence
// proof that a run happened and its deliveries arrived, so "no second nudge" is not just "too early".
let witness: Committed;

test.use({ ownerCredentials: { email: 'followups@example.com', password: 'correct-horse-battery-staple' } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'followups');
  await resetSink(o.request);
  await createHook(o, SINK, ['application.followup_due']);
  silent = await commitApplication(o, 0);
  opened = await commitApplication(o, 1);
  witness = await commitApplication(o, 2);
  const visitor = await playwright.request.newContext();
  const sess = await issueSession(visitor, { handle: o.handle, code: opened.code, visitor_name: 'Recruiter' });
  await sendMessage(visitor, sess, 'Hello there.');
  await visitor.dispose();
});
test.afterAll(async () => { await o.request.dispose(); });

const due = (id: string): void =>
  execSQL(`UPDATE applications SET next_followup_at = now() - interval '1 minute' WHERE id = '${id}'`);
const runTask = (): Promise<unknown> =>
  callTool(o.request, o.apiToken, o.sid, 'tasks.run_periodic', { name: 'application followups' });
const nextAt = (id: string): number =>
  Date.parse(querySQL(`SELECT to_char(next_followup_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM applications WHERE id = '${id}'`));

async function announced(id: string): Promise<SinkDelivery[]> {
  return accepted(await received(o.request, SINK))
    .filter((d) => d.body.type === 'application.followup_due' && d.body.data['application_id'] === id);
}

test('3.1.a — commit sets the follow-up a week out', () => {
  const days = (nextAt(silent.applicationID) - Date.now()) / 86_400_000;
  expect(days, 'about seven days').toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);
});

test('3.1.a — due and unopened: announced once across two runs; opened: never nudged blind', async () => {
  due(silent.applicationID);
  due(opened.applicationID);
  await runTask();
  await expect.poll(async () => (await announced(silent.applicationID)).length,
    { timeout: 30_000, message: 'the silent one is announced' }).toBe(1);
  due(witness.applicationID);
  await runTask();
  await expect.poll(async () => (await announced(witness.applicationID)).length,
    { timeout: 30_000, message: 'presence: the second run ran and delivered' }).toBe(1);
  expect(await announced(silent.applicationID), 'once, across two runs').toHaveLength(1);
  expect((await announced(silent.applicationID))[0]!.body.data).toMatchObject({ application_id: silent.applicationID, code_id: silent.codeID, nudge: 1 });
  expect(await announced(opened.applicationID), 'the opened one is not nudged blind').toHaveLength(0);
  expect((nextAt(silent.applicationID) - Date.now()) / 86_400_000, 'the marker moved a week on').toBeGreaterThan(6.9);
});

test('3.1.c — followups_due lists it; after two nudges it is cold', async () => {
  due(silent.applicationID);
  const list = await callTool<{ due: { application_id: string; nudges: number }[] }>(
    o.request, o.apiToken, o.sid, 'applications.followups_due', {});
  expect(list.due.map((d) => d.application_id), 'due now, before the task runs').toEqual([silent.applicationID]);
  expect((await applicationRow(o, silent.applicationID) as unknown as { followup: string }).followup).toBe('due');
  await runTask();
  await expect.poll(async () => (await announced(silent.applicationID)).length, { timeout: 30_000 }).toBe(2);
  due(silent.applicationID);
  due(witness.applicationID);
  await runTask();
  await expect.poll(async () => (await announced(witness.applicationID)).length,
    { timeout: 30_000, message: 'presence: that run ran and delivered' }).toBe(2);
  expect(await announced(silent.applicationID), 'no third nudge').toHaveLength(2);
  expect((await applicationRow(o, silent.applicationID) as unknown as { followup: string }).followup, 'cold').toBe('cold');
});

test('3.1.b — the cadence follows the outcome', async () => {
  await updateOutcome(o, opened.applicationID, 'interview', 'onsite done');
  const days = (nextAt(opened.applicationID) - Date.now()) / 86_400_000;
  expect(days, 'a thank-you a day after the interview').toBeGreaterThan(0.9);
  expect(days).toBeLessThan(1.1);
  await updateOutcome(o, opened.applicationID, 'offer', '');
  expect(querySQL(`SELECT coalesce(next_followup_at::text, 'none') FROM applications WHERE id = '${opened.applicationID}'`),
    'an offer needs no reminder').toBe('none');
});

test('3.1.c — the admin row says follow-up due', async ({ adminPage: page }) => {
  const third = await commitApplication(o, 3);
  due(third.applicationID);
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId(`application-followup-${third.applicationID}`)).toContainText(/follow.up due/i, { timeout: 15_000 });
  await expect(page.getByTestId(`application-row-${silent.applicationID}`), 'presence: the cold row').toBeVisible();
  await expect(page.getByTestId(`application-followup-${silent.applicationID}`)).toContainText(/cold/i);
});
