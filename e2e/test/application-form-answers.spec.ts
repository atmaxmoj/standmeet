// application-form-answers.spec.ts —— roadmap 5.4.a/b: application forms are answered from what I
// already said.
//
// "Done" (roadmap): a Greenhouse job returns its questions; an answer stored on one application is
// offered for the same question on the next; authorization, salary and demographic answers always
// need my confirmation.
//
// Contract:
//   - jobs.show adds `questions: [{label, required, fields: [{name, type, options}], confirm,
//     previous_answer?: {answer, application_id}}]` for a Greenhouse posting (others: []).
//     confirm = the owner must confirm the answer each time (work authorization, sponsorship,
//     salary, demographic).
//   - applications.save_answers {application_id, answers: [{question, answer}]} stores the answers
//     a form was filled with; the next posting asking the same question (case, spacing and
//     punctuation aside) offers the latest one as previous_answer.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callTool } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource, jobsShow, type FetchedJobView } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

interface Question {
  label: string; required: boolean; confirm: boolean;
  fields: { name: string; type: string; options: string[] }[];
  previous_answer?: { answer: string; application_id: string };
}
type Shown = FetchedJobView & { questions?: Question[] };

const WHY = 'Why do you want to work at Beta Labs?';
const AUTH = 'Are you legally authorized to work in the United States?';
const SALARY = 'What are your salary expectations?';

let o: LoopOwner;
let beta: FetchedJobView[] = [];

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'formanswers');
  const gh = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  beta = (await jobsFetchNew(o.request, o.apiToken, o.sid, gh.id)).jobs.filter((j) => j.source_id === gh.id);
  if (beta.length < 2) throw new Error('precondition: the betalabs board pooled both postings');
});
test.afterAll(async () => { await o.request.dispose(); });

async function questions(job: FetchedJobView): Promise<Question[]> {
  return ((await jobsShow(o.request, o.apiToken, o.sid, job.cache_id)) as Shown).questions ?? [];
}

const byLabel = (qs: Question[], label: string): Question | undefined => qs.find((q) => q.label === label);

test('5.4.a — a Greenhouse posting shows its form; authorization and salary need confirming', async () => {
  const qs = await questions(beta[0]!);
  expect(qs.map((q) => q.label)).toEqual(['First Name', 'Resume/CV', WHY, AUTH, SALARY]);
  expect(byLabel(qs, AUTH)?.fields[0]?.options, 'a select names its options').toEqual(['Yes', 'No']);
  expect(byLabel(qs, WHY)?.confirm, 'an open question does not').toBe(false);
  expect(byLabel(qs, AUTH)?.confirm, 'work authorization does').toBe(true);
  expect(byLabel(qs, SALARY)?.confirm, 'salary does').toBe(true);
  expect(qs.some((q) => q.previous_answer), 'nothing answered yet').toBe(false);
});

test('5.4.b — answers stored on one application are offered on the next posting', async () => {
  const drafted = await resumeDraft(o.request, o.apiToken, o.sid, beta[0]!.cache_id, sampleResumeContent());
  const app = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  await callTool(o.request, o.apiToken, o.sid, 'applications.save_answers', {
    application_id: app.view.application_id,
    answers: [
      { question: 'why do you want to work at Beta Labs', answer: 'ZEBRA: the platform team ships weekly.' },
      { question: AUTH, answer: 'Yes' },
    ],
  });
  const next = await questions(beta[1]!);
  expect(byLabel(next, WHY)?.previous_answer, 'same question, case and punctuation aside').toEqual({
    answer: 'ZEBRA: the platform team ships weekly.', application_id: app.view.application_id,
  });
  expect(byLabel(next, AUTH)?.previous_answer?.answer, 'offered…').toBe('Yes');
  expect(byLabel(next, AUTH)?.confirm, '…and still needs confirming').toBe(true);
  expect(byLabel(next, SALARY)?.previous_answer, 'never answered, nothing offered').toBeUndefined();
});

test('a posting whose board has no form says so with an empty list', async () => {
  const airbnb = o.jobs[0]!;
  const shown = (await jobsShow(o.request, o.apiToken, o.sid, airbnb.cache_id)) as Shown;
  expect(shown.cache_id, 'presence: the posting is read').toBe(airbnb.cache_id);
  expect(shown.questions ?? [], 'no form').toEqual([]);
});
