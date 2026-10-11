// job-reposts.spec.ts —— roadmap 1.5.b: the ledger counts how often a company posted the same job
// again. Facts only: the count does not touch scoring.
//
// Contract:
//   - A repost is the same company::title::location under a different URL, seen more than 7 days
//     after the ledger last saw the job. Its ledger row's `reposts` goes up by one.
//   - The same job under a different URL seen within 7 days is the board listing it twice, not a
//     repost: `reposts` stays.
//   - jobs.history rows carry `reposts` (0 for a job posted once).
// Time passing is set up by moving the row's last_seen_at back; nothing is asserted through SQL.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { execSQL } from '@/fixtures/instance';
import { allHistory, jobsRecord } from '@/fixtures/job-ledger';

const JOB = { title: 'Staff Data Engineer', company: 'Repost Co', location: 'Remote' };

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'reposts');
});
test.afterAll(async () => { await o.request.dispose(); });

async function repostsOf(): Promise<number | undefined> {
  const row = (await allHistory(o)).find((r) => r.company === JOB.company);
  return row?.reposts;
}

test('1.5.b — a different URL the same week is not a repost', async () => {
  const [first] = await jobsRecord(o, [{ ...JOB, url: 'https://jobs.repost.example/1' }]);
  expect(first?.new).toBe(true);
  expect(await repostsOf(), 'presence: a job posted once reads 0').toBe(0);
  const [again] = await jobsRecord(o, [{ ...JOB, url: 'https://jobs.repost.example/2' }]);
  expect(again?.new, 'the same job').toBe(false);
  expect(await repostsOf()).toBe(0);
});

test('1.5.b — the same job under a new URL weeks later is counted', async () => {
  execSQL(`UPDATE job_seen SET last_seen_at = now() - interval '20 days'
           WHERE snapshot->>'company' = '${JOB.company}'`);
  const [again] = await jobsRecord(o, [{ ...JOB, url: 'https://jobs.repost.example/3' }]);
  expect(again?.new, 'still the same ledger row').toBe(false);
  expect(await repostsOf()).toBe(1);
});
