// draft-from-ledger.spec.ts —— roadmap 8.4.a / 8.4.b: a pick becomes a draft even after the pool
// forgot it, and committing marks the ledger row applied.
//
// "Done" (roadmap): with the posting gone from the pool, resume.draft by job_seen_id succeeds; after
// commit, history shows that row applied with the application's id.
//
// Contract: fixtures/job-ledger.ts. A posting Job Scout recorded was never pooled at all — the
// plainest "not in the pool".

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callToolOutcome } from '@/fixtures/mcp';
import { allHistory, jobsRecord } from '@/fixtures/job-ledger';
import { applicationsCommit, resumeDraftWith, sampleResumeContent } from '@/fixtures/resume';

let o: LoopOwner;
let seenID = '';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'draftledger');
  const [rec] = await jobsRecord(o, [{
    title: 'Ledger Engineer', company: 'Delta Systems', location: 'Remote',
    url: 'https://jobs.delta.example/ledger-1', body_text: 'Build the ledger. Own the data model.',
    source: 'linkedin',
  }]);
  seenID = rec!.job_seen_id;
});
test.afterAll(async () => { await o.request.dispose(); });

test('8.4.a/b — draft from the ledger row, commit, and the row reads applied', async () => {
  const drafted = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_seen_id: seenID, resume_content: sampleResumeContent() });
  expect(drafted.view.draft_id, 'a draft from a posting the pool never held').toBeTruthy();

  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  const row = (await allHistory(o)).find((r) => r.job_seen_id === seenID);
  expect(row?.status, 'committed → applied').toBe('applied');
  expect(row?.application_id, 'with the application it became').toBe(c.view.application_id);
});

test('a job_seen_id that is not this owner\'s is refused by name', async () => {
  const out = await callToolOutcome(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_seen_id: '00000000-0000-0000-0000-000000000000', resume_content: sampleResumeContent() });
  expect(out.isError, 'refused').toBe(true);
  expect(out.text, 'naming what is missing').toMatch(/job_seen_id|posting/i);
  expect(out.text, 'no stack trace').not.toMatch(/panic|goroutine|\.go:\d+/);
});
