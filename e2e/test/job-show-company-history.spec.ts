// job-show-company-history.spec.ts —— roadmap 1.5.a: reading a posting shows what already happened with
// that company.
//
// "Done" (roadmap): a company applied to before lists that application's date, outcome and whether it
// was opened; a company never applied to lists nothing. Facts only — no verdict, no effect on scoring.
//
// Contract: jobs.show adds `previous_applications: [{application_id, applied_at, outcome, opened_at}]`,
// matched on the normalised company name; empty (or absent) when there are none.

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { jobsFetchNew, jobsRegisterSource, jobsShow, type FetchedJobView } from '@/fixtures/jobs';

interface PreviousApplication { application_id: string; applied_at: string; outcome: string; opened_at: string | null }
type ShownJob = FetchedJobView & { previous_applications?: PreviousApplication[] };

let o: LoopOwner;
let app: Committed;
let otherCompany: FetchedJobView;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupLoopOwner(playwright, 'jobhistory');
  app = await commitApplication(o, 0);
  const stripe = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'Stripe', config: { company: 'stripe' },
  });
  const fetched = await jobsFetchNew(o.request, o.apiToken, o.sid, stripe.id);
  const job = fetched.jobs.find((j) => j.company !== app.job.company);
  if (!job) throw new Error('the stripe board returned no job of another company');
  otherCompany = job;
});
test.afterAll(async () => { await o.request.dispose(); });

test('another posting from the company applied to lists that application', async () => {
  const sibling = o.jobs.find((j) => j.company === app.job.company && j.cache_id !== app.job.cache_id);
  if (!sibling) throw new Error('precondition: the board has a second posting from the same company');
  const shown = await jobsShow(o.request, o.apiToken, o.sid, sibling.cache_id) as ShownJob;
  expect(shown.cache_id, 'presence: the posting itself is read').toBe(sibling.cache_id);
  const prev = shown.previous_applications ?? [];
  expect(prev.map((p) => p.application_id), 'the earlier application is listed').toEqual([app.applicationID]);
  expect(prev[0]!.outcome).toBe('none');
  expect(prev[0]!.opened_at, 'nobody opened it yet').toBeNull();
  expect(Date.parse(prev[0]!.applied_at), 'the application date is a real time').not.toBeNaN();
});

test('a company never applied to lists nothing', async () => {
  const shown = await jobsShow(o.request, o.apiToken, o.sid, otherCompany.cache_id) as ShownJob;
  expect(shown.cache_id, 'presence: the posting itself is read').toBe(otherCompany.cache_id);
  expect(shown.previous_applications ?? [], 'no history with this company').toEqual([]);
});
