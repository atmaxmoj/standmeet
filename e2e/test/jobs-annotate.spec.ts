// jobs-annotate.spec.ts —— roadmap 4.1.d / 8.2.a: the AI's assessment of a posting is kept on its
// ledger row, and never reaches a recruiter.
//
// "Done" (roadmap): annotate, then the score is still there after the pool forgot the posting;
// after commit, the recruiter's briefing has no score.
//
// Contract: fixtures/job-ledger.ts (jobs.annotate, jobs.history).

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsDiscard } from '@/fixtures/jobs';
import { allHistory, jobsAnnotate, type Annotations } from '@/fixtures/job-ledger';
import { issueSession } from '@/fixtures/visitor';

const NOTE = {
  score: 7.5,
  reason: 'ZEBRAREASON strong platform overlap',
  deductions: [{ points: -1, why: 'ZEBRADEDUCT on-site three days' }],
  cited_notes: ['wiki/platform-migration'],
  flags: ['visa-sponsorship-unclear'],
  interview_reports: ['ZEBRAREPORT two rounds, system design heavy'],
} satisfies Annotations;

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'jobsannotate');
});
test.afterAll(async () => { await o.request.dispose(); });

function seenID(n: number): string {
  const id = (o.jobs[n] as { job_seen_id?: string }).job_seen_id;
  if (!id) throw new Error(`pool row ${n} carries no job_seen_id`);
  return id;
}

test('every field comes back from history, after the pool dropped the posting', async () => {
  const back = await jobsAnnotate(o, seenID(1), NOTE);
  expect(back.score, 'the receipt is the stored row').toBe(7.5);
  await jobsDiscard(o.request, o.apiToken, o.sid, o.jobs[1]!.cache_id);
  const row = (await allHistory(o)).find((r) => r.job_seen_id === seenID(1));
  expect(row, 'presence: the row is in history').toBeTruthy();
  expect(row).toMatchObject(NOTE);
});

test("the recruiter's briefing carries none of it", async () => {
  await jobsAnnotate(o, seenID(0), NOTE);
  const app = await commitApplication(o, 0);
  const sess = await issueSession(o.request, { handle: o.handle, code: app.code, visitor_name: 'Recruiter' });
  const persona = sess.system_prompt_persona ?? '';
  expect(persona, 'presence: the briefing names the role').toContain(o.jobs[0]!.title.slice(0, 12));
  for (const marker of ['ZEBRAREASON', 'ZEBRADEDUCT', 'ZEBRAREPORT', '7.5']) {
    expect(persona, `no ${marker} in what the recruiter's agent reads`).not.toContain(marker);
  }
});
