// company-marks.spec.ts —— roadmap 4.1.e: a company I will not apply to is flagged when its postings
// arrive, and drafting for it asks me to say so.
//
// "Done" (roadmap): mark a company; its postings arrive flagged; resume.draft for one is refused
// unless override is passed.
//
// Contract: fixtures/job-ledger.ts (jobs.mark_company). A mark matches on the company name the way
// the dedup layer normalizes it (case, legal suffix): "Beta-Labs Inc." marks "beta-labs".

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callToolOutcome } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource, type FetchedJobView } from '@/fixtures/jobs';
import { jobsMarkCompany } from '@/fixtures/job-ledger';
import { resumeDraftWith, sampleResumeContent } from '@/fixtures/resume';

type Flagged = FetchedJobView & { flags?: string[] };

let o: LoopOwner;
let rows: readonly Flagged[] = [];

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'companymarks');
});
test.afterAll(async () => { await o.request.dispose(); });

test('a marked company\'s postings arrive flagged; others do not', async () => {
  const back = await jobsMarkCompany(o, 'Beta-Labs Inc.', 'do_not_apply', 'they ghosted me twice');
  expect(back.mark).toBe('do_not_apply');
  const gh = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  rows = (await jobsFetchNew(o.request, o.apiToken, o.sid, gh.id)).jobs;
  const beta = rows.filter((j) => j.company === 'beta-labs');
  expect(beta, 'presence: the marked company\'s two postings').toHaveLength(2);
  expect(beta.every((j) => (j.flags ?? []).includes('do_not_apply')), 'each is flagged').toBe(true);
  const other = rows.filter((j) => j.company !== 'beta-labs');
  expect(other.length, 'presence: the other board is in the window').toBeGreaterThan(0);
  expect(other.some((j) => (j.flags ?? []).includes('do_not_apply')), 'no one else is flagged').toBe(false);
});

test('drafting for it is refused by name; override drafts it', async () => {
  const job = rows.find((j) => j.company === 'beta-labs')!;
  const refused = await callToolOutcome(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_cache_id: job.cache_id, resume_content: sampleResumeContent() });
  expect(refused.isError, 'refused').toBe(true);
  expect(refused.text, 'names the mark').toMatch(/do.not.apply/i);
  expect(refused.text, 'and how to go ahead').toMatch(/override/i);

  const drafted = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: job.cache_id, resume_content: sampleResumeContent(), override: true });
  expect(drafted.view.draft_id, 'override drafts it').toBeTruthy();
});

test('clearing the mark clears the flag on the next read', async () => {
  await jobsMarkCompany(o, 'beta-labs', 'none');
  const again = (await jobsFetchNew(o.request, o.apiToken, o.sid)).jobs as Flagged[];
  const beta = again.filter((j) => j.company === 'beta-labs');
  expect(beta.length, 'presence: still in the window').toBeGreaterThan(0);
  expect(beta.some((j) => (j.flags ?? []).includes('do_not_apply')), 'no flag after clearing').toBe(false);
});
