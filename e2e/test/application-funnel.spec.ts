// application-funnel.spec.ts —— roadmap 3.2.a: I see an honest funnel.
//
// "Done" (roadmap): below 20 rows no median is shown; a rejection after an interview still counts
// the interview.
//
// Contract: applications.funnel {} → {total, reached: {opened, responded, interview, offer,
// hired, rejected, withdrawn}, median_days: {to_open, to_first_outcome} (null below 20 samples),
// samples: {to_open, to_first_outcome}, excluded_waiting}. A stage counts every application that
// ever reached it (from the outcome journal). excluded_waiting: applications with no outcome yet,
// left out of to_first_outcome.

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, updateOutcome, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';

interface Funnel {
  total: number;
  reached: Record<string, number>;
  median_days: { to_open: number | null; to_first_outcome: number | null };
  samples: { to_open: number; to_first_outcome: number };
  excluded_waiting: number;
}

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'funnel');
});
test.afterAll(async () => { await o.request.dispose(); });

const funnel = (): Promise<Funnel> => callTool<Funnel>(o.request, o.apiToken, o.sid, 'applications.funnel', {});

test('a rejection after an interview still counts the interview; below 20 there is no median', async () => {
  const a = await commitApplication(o, 0);
  const b = await commitApplication(o, 1);
  await commitApplication(o, 2);
  await updateOutcome(o, a.applicationID, 'interview', '');
  await updateOutcome(o, a.applicationID, 'rejected', '');
  await updateOutcome(o, b.applicationID, 'responded', '');
  const f = await funnel();
  expect(f.total).toBe(3);
  expect(f.reached['interview'], 'the rejected one reached an interview').toBe(1);
  expect(f.reached['rejected']).toBe(1);
  expect(f.reached['responded'], 'responded counts anyone who answered, interviews included').toBe(2);
  expect(f.median_days.to_first_outcome, 'two samples: no median').toBeNull();
  expect(f.samples.to_first_outcome).toBe(2);
  expect(f.excluded_waiting, 'the third has no outcome yet').toBe(1);
});

// to_first_outcome counts from commit (an application answered without being opened still had a
// first outcome), so backdating created_at sets the days.
test('at 20 samples the median is shown', async () => {
  for (let i = 0; i < 18; i++) {
    const c = await commitApplication(o, 3 + (i % 5));
    execSQL(`UPDATE applications SET created_at = now() - interval '10 days' WHERE id = '${c.applicationID}'`);
    await updateOutcome(o, c.applicationID, 'responded', '');
  }
  const f = await funnel();
  expect(f.samples.to_first_outcome, 'twenty answered').toBe(20);
  expect(f.median_days.to_first_outcome, 'eighteen at ten days, two at zero').toBeCloseTo(10, 0);
});
