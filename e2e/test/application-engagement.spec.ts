// application-engagement.spec.ts —— roadmap 2.1 / 2.3 / 2.5: what the recruiter asked, what my
// corpus could not answer, and what the agent already told them on pay, start date, availability
// and work authorization.
//
// "Done" (roadmap): of two answers, one that read an entry and one that used nothing, only the
// second is a gap (2.1); an answer on pay is flagged and quoted verbatim (2.3); gaps from all
// applications are listed with counts, and an application with no gaps adds nothing (2.5).
//
// Contract:
//   - applications.engagement {application_id} → {questions: [{conversation_id, asked_at,
//     question, answer, grounded, topics: ('pay'|'start'|'availability'|'authorization')[]}],
//     gaps}. grounded = the answer cited or read an entry (a corpus_read that succeeded, any
//     citation, a grounded subjectivity note). topics = what the question raised; the answer to
//     it is quoted whole (the answer's own wording is not scanned: "when you're available" is no
//     commitment).
//   - applications.gaps {} → {gaps: [{question, count, application_ids}]}.
//   - GET /api/admin/applications/{id} adds `questions` (same shape); the detail modal lists them
//     (`application-question-row`, data-gap="true" on a gap) (2.1.c).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  applicationDetail, commitApplication, setupLoopOwner, type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { seedWiki } from '@/fixtures/corpus';
import { callTool } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

interface Exchange {
  conversation_id: string; asked_at: string; question: string; answer: string;
  grounded: boolean; topics: string[];
}
interface Engagement { questions: Exchange[]; gaps: number }
interface Gap { question: string; count: number; application_ids: string[] }

const PLATFORM_PATH = 'work/platform-migration';
const PAY_ANSWER = 'I am looking for a base salary around $185k.';

let o: LoopOwner;
let app: Committed;
let visitor: APIRequestContext;

test.use({ ownerCredentials: { email: 'engagement@example.com', password: 'correct-horse-battery-staple' } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'engagement');
  await seedWiki(o.request, o.apiToken, o.sid, {
    title: 'Platform migration', body: 'Moved 40 services to one platform in 2024.', path: PLATFORM_PATH,
  });
  app = await commitApplication(o, 0);
  visitor = await playwright.request.newContext();
  const sess = await issueSession(visitor, { handle: o.handle, code: app.code, visitor_name: 'Recruiter' });
  const read = await scriptMockToolCall(visitor, { name: 'corpus_read', args: { path: PLATFORM_PATH } });
  await sendMessage(visitor, sess, `What did you build on the platform team?${read}`);
  await sendMessage(visitor, sess, 'How do you handle conflict on a team?');
  const pay = await scriptMockReplyText(visitor, PAY_ANSWER);
  await sendMessage(visitor, sess, `What salary are you expecting?${pay}`);
});
test.afterAll(async () => {
  await visitor.dispose();
  await o.request.dispose();
});

function engagement(id: string): Promise<Engagement> {
  return callTool<Engagement>(o.request, o.apiToken, o.sid, 'applications.engagement', { application_id: id });
}

test('2.1.b — the answer that read an entry is grounded; the one that used nothing is a gap', async () => {
  const e = await engagement(app.applicationID);
  expect(e.questions, 'presence: every question the recruiter asked').toHaveLength(3);
  const [built, conflict] = e.questions;
  expect(built!.question).toContain('What did you build on the platform team?');
  expect(built!.grounded, 'it read the platform note').toBe(true);
  expect(conflict!.question).toContain('How do you handle conflict');
  expect(conflict!.grounded, 'nothing in the corpus behind it').toBe(false);
  expect(e.gaps).toBe(2);
});

test('2.3.a — an answer about pay is flagged and quoted verbatim', async () => {
  const pay = (await engagement(app.applicationID)).questions[2]!;
  expect(pay.topics).toEqual(['pay']);
  expect(pay.answer, 'verbatim').toContain(PAY_ANSWER);
  const built = (await engagement(app.applicationID)).questions[0]!;
  expect(built.topics, 'a plain question has none').toEqual([]);
});

test('2.5.a — gaps across applications, counted; an application with no gaps adds nothing', async () => {
  const before = (await callTool<{ gaps: Gap[] }>(o.request, o.apiToken, o.sid, 'applications.gaps', {})).gaps;
  expect(before.map((g) => g.count).reduce((a, b) => a + b, 0), 'the two gaps').toBe(2);
  expect(before.find((g) => g.question.includes('conflict'))?.application_ids).toEqual([app.applicationID]);
  await commitApplication(o, 1);
  const after = (await callTool<{ gaps: Gap[] }>(o.request, o.apiToken, o.sid, 'applications.gaps', {})).gaps;
  expect(after, 'an untouched application adds nothing').toEqual(before);
});

test('2.1.c — the admin detail lists their questions with the gaps marked', async ({ adminPage: page }) => {
  expect((await applicationDetail(o, app.applicationID) as unknown as { questions: Exchange[] }).questions,
    'the detail route carries them').toHaveLength(3);
  await gotoAdminSection(page, 'applications');
  await page.getByTestId(`application-row-${app.applicationID}`).getByRole('button').first().click();
  const rows = page.getByTestId('application-detail-modal').getByTestId('application-question-row');
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  await expect(rows.and(page.locator('[data-gap="true"]')), 'two gaps marked').toHaveCount(2);
  await expect(rows.first()).toContainText('platform team');
});
