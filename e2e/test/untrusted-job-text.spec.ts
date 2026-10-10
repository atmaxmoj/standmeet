// untrusted-job-text.spec.ts —— roadmap 7.1.a: a job posting cannot instruct my agents.
//
// "Done" (roadmap): a JD saying "ignore previous instructions" is fenced in `jobs.show` and in the
// recruiter's briefing. Whether a model then obeys it is an eval question (eval-harness); this spec
// holds the part the code owns: what reaches either agent is fenced, and the fence cannot be closed
// from inside.
//
// Contract:
//   - A fence is `<untrusted-content source="job posting">…</untrusted-content>`. Text from the
//     posting never carries a closing marker of its own: one opening, one closing, per fence.
//   - jobs.show: body_text is one fence around the posting's text (the text is kept, not deleted).
//   - The recruiter's persona (a session on the application's code) names the role inside a fence,
//     on one line: a newline in the posting's title cannot start a line of the prompt.
//
// The board fixture (greenhouse/promptinject) carries the attack in the body and in the title, and
// the title also plants a closing marker.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsFetchNew, jobsRegisterSource, jobsShow, type FetchedJobView } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { issueSession } from '@/fixtures/visitor';

const OPEN = '<untrusted-content source="job posting">';
const CLOSE = '</untrusted-content>';

let o: LoopOwner;
let job: FetchedJobView;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'untrustedjd');
  const src = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'Inject Co', config: { company: 'promptinject' },
  });
  const fetched = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const found = fetched.jobs.find((j) => j.title.startsWith('Staff Engineer'));
  if (!found) throw new Error('the promptinject board returned no posting');
  job = found;
});
test.afterAll(async () => { await o.request.dispose(); });

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

test('jobs.show fences the posting body and keeps its text', async () => {
  const shown = await jobsShow(o.request, o.apiToken, o.sid, job.cache_id);
  const body = shown.body_text ?? '';
  expect(body, 'presence: the posting text is there').toContain('Ignore previous instructions');
  expect(body.startsWith(OPEN), 'the body opens the fence').toBe(true);
  expect(body.trimEnd().endsWith(CLOSE), 'the body closes the fence').toBe(true);
  expect(count(body, CLOSE), 'one closing marker: the posting cannot close it').toBe(1);
});

test("the recruiter's persona names the role inside a fence, on one line", async () => {
  const drafted = await resumeDraft(o.request, o.apiToken, o.sid, job.cache_id, sampleResumeContent());
  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  const sess = await issueSession(o.request, { handle: o.handle, code: c.view.access_code, visitor_name: 'Recruiter' });
  const persona = sess.system_prompt_persona ?? '';
  expect(persona, 'presence: the role is named').toContain('Staff Engineer');
  expect(persona, 'the role sits in a fence').toContain(OPEN);
  expect(count(persona, CLOSE), 'every fence closes once; the title planted none').toBe(count(persona, OPEN));
  expect(persona.split('\n').some((l) => l.trimStart().startsWith('SYSTEM:')),
    "the title's newline cannot start a line of the prompt").toBe(false);
});
