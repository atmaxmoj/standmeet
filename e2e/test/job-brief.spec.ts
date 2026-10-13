// job-brief.spec.ts —— BLACK BOX. The owner wants to piece together the whole job from its sides
// (the company, the posting, the stack, the team) long before a call, and have it at hand when the
// recruiter phones (owner, 2026-10-13). The screen assistant finds it by reading the applied rows.
//
// Contract (fixtures/job-ledger.ts): jobs.annotate takes `brief`, a markdown picture of the job,
// written before applying. After applications.commit, jobs.history {status: 'applied'} returns the
// row with its brief and its application_id. The recruiter's agent never reads the brief.

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsAnnotate, jobsHistory } from '@/fixtures/job-ledger';
import { issueSession } from '@/fixtures/visitor';

const BRIEF = '## Team\nZEBRABRIEF platform team, 6 engineers, Go + Postgres\n\n' +
  '## Likely questions\n- why platform work';

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'jobbrief');
});
test.afterAll(async () => { await o.request.dispose(); });

test('a brief written before applying comes back on the applied row, never to the recruiter', async () => {
  const seen = (o.jobs[0] as { job_seen_id?: string }).job_seen_id;
  if (!seen) throw new Error('pool row 0 carries no job_seen_id');
  await jobsAnnotate(o, seen, { brief: BRIEF });

  const app = await commitApplication(o, 0);
  const applied = (await jobsHistory(o, { status: 'applied' })).items;
  const row = applied.find((r) => r.job_seen_id === seen);
  expect(row, 'presence: the applied row').toBeTruthy();
  expect(row!.application_id, 'linked to the application').toBeTruthy();
  expect(row!.brief, 'the brief rode along').toBe(BRIEF);

  const sess = await issueSession(o.request, { handle: o.handle, code: app.code, visitor_name: 'Recruiter' });
  const persona = sess.system_prompt_persona ?? '';
  expect(persona, 'presence: the briefing names the role').toContain(o.jobs[0]!.title.slice(0, 12));
  expect(persona, 'the recruiter\'s agent does not read it').not.toContain('ZEBRABRIEF');
});
