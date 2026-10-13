// job-homework.spec.ts —— BLACK BOX. Half of the owner's homework on a job is for the recruiter's
// agent: what the owner learned about the company and team, and why they fit (owner, 2026-10-13:
// "可能有一半要进到那个agent的视野，就是我做好的功课"). The other half (`brief`) stays private.
//
// Contract (fixtures/job-ledger.ts): jobs.annotate takes `homework`. A recruiter session on the
// application's own code is offered `homework_read` (no arguments) and reads THAT application's
// homework, live. An application without homework, or a plain code, is not offered the tool. The
// private brief never reaches the recruiter's model. Homework naming pay or work authorization is
// refused, and the row keeps what it had.

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { allHistory, jobsAnnotate } from '@/fixtures/job-ledger';
import { callToolOutcome } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/blocks';
import { gatewayRequestExists, resetGatewayRequests, scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const TOOL = 'homework_read';
const HOMEWORK = 'ZEBRAHOME I read how your merchant risk team scores card payments in real time.';
const BRIEF = 'ZEBRAPRIVATE they may lowball; ask about the reorg.';

let o: LoopOwner;
let withHomework = '';
let without = '';

function seenID(n: number): string {
  const id = (o.jobs[n] as { job_seen_id?: string }).job_seen_id;
  if (!id) throw new Error(`pool row ${n} carries no job_seen_id`);
  return id;
}

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'jobhomework');
  await jobsAnnotate(o, seenID(0), { homework: HOMEWORK, brief: BRIEF });
  withHomework = (await commitApplication(o, 0)).code;
  without = (await commitApplication(o, 1)).code;
});
test.afterAll(async () => { await o.request.dispose(); });

test('the recruiter reads this application\'s homework, never the private brief', async () => {
  const sess = await issueSession(o.request, { handle: o.handle, code: withHomework, visitor_name: 'Recruiter' });
  expect(await sessionToolNames(o.request, sess.session_token), 'offered on its own code').toContain(TOOL);

  await resetGatewayRequests(o.request);
  const tag = await scriptMockToolCall(o.request, { name: TOOL, args: {} });
  await sendAndDrain(o.request, sess, `What does the candidate know about our team?${tag}`);
  expect(await gatewayRequestExists(o.request, 'ZEBRAHOME'), 'the homework reached the model').toBe(true);
  expect(await gatewayRequestExists(o.request, 'ZEBRAPRIVATE'), 'the brief never does').toBe(false);
});

test('an application without homework is not offered the tool', async () => {
  const sess = await issueSession(o.request, { handle: o.handle, code: without, visitor_name: 'Recruiter' });
  const tools = await sessionToolNames(o.request, sess.session_token);
  expect(tools, 'presence: the résumé tool is there').toContain('resume_read');
  expect(tools).not.toContain(TOOL);
});

test('homework naming pay or work authorization is refused, and the row keeps what it had', async () => {
  for (const bad of ['I expect a base salary of $180k.', 'I hold an open work permit.']) {
    const res = await callToolOutcome(o.request, o.apiToken, o.sid, 'jobs.annotate', { job_seen_id: seenID(0), homework: bad });
    expect(res.isError, `refused: ${bad}`).toBe(true);
    expect(res.text, 'the refusal says why').toMatch(/pay|authorization/i);
  }
  const row = (await allHistory(o)).find((r) => r.job_seen_id === seenID(0));
  expect(row?.homework, 'unchanged').toBe(HOMEWORK);
});
