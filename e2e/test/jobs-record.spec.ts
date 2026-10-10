// jobs-record.spec.ts —— roadmap 8.1.a: Job Scout's postings enter the same ledger the boards write;
// the server dedups.
//
// "Done" (roadmap): two postings in one call, one of them the same job as a ledger row behind a
// tracking parameter → one new, one seen (with the date it was first seen).
//
// Contract: fixtures/job-ledger.ts (jobs.record). Keys are the canonical URL (tracking parameters
// dropped) and company::title::location; either one matching means "seen".

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { allHistory, jobsRecord } from '@/fixtures/job-ledger';

const FRONTEND_URL = 'https://boards.greenhouse.io/betalabs/jobs/4002';

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'jobsrecord');
});
test.afterAll(async () => { await o.request.dispose(); });

test('a posting Job Scout recorded is not pooled again by a board', async () => {
  const [first] = await jobsRecord(o, [{
    title: 'Senior Frontend Engineer', company: 'beta-labs', location: 'Remote (US)',
    url: `${FRONTEND_URL}?utm_source=linkedin`, source: 'linkedin',
  }]);
  expect(first?.new, 'first time anyone saw it').toBe(true);
  expect(first?.job_seen_id).toBeTruthy();

  const gh = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, gh.id);
  const tally = (res.sources ?? []).find((t) => t.source_id === gh.id);
  expect(tally?.seen, 'presence: the board offered both').toBe(2);
  expect(tally?.pooled, 'the recorded one is seen; only the other is pooled').toBe(1);
  expect(res.jobs.some((j) => j.url === FRONTEND_URL), 'not back through the board').toBe(false);
});

test('one call, two postings: the same job behind a tracking parameter is seen, the other is new', async () => {
  const airbnb = o.jobs[0]!;
  const [seenByURL, seenByKey, fresh] = await jobsRecord(o, [
    { title: 'Senior Frontend Engineer', company: 'beta-labs', url: `${FRONTEND_URL}?utm_campaign=x&ref=li` },
    { title: airbnb.title, company: airbnb.company, location: airbnb.location, url: 'https://www.linkedin.com/jobs/view/123' },
    { title: 'Platform Engineer', company: 'Gamma Works', location: 'Berlin', url: 'https://jobs.gamma.example/42' },
  ]);
  const ledger = await allHistory(o);
  const original = ledger.find((r) => r.url.startsWith(FRONTEND_URL));
  expect(seenByURL?.new, 'canonical URL matches').toBe(false);
  expect(seenByURL?.job_seen_id, 'the same ledger row').toBe(original?.job_seen_id);
  expect(seenByURL?.first_seen_at, 'with the day it was first seen').toBe(original?.first_seen_at);
  expect(seenByKey?.new, 'company::title::location matches a board posting').toBe(false);
  expect(fresh?.new, 'presence: a new posting is new').toBe(true);
  expect(ledger.filter((r) => r.company === 'Gamma Works'), 'it is in the ledger once').toHaveLength(1);
});
