// application-export.spec.ts —— roadmap 7.5.a: my applications are mine, as files.
//
// "Done" (test plan): export one application; the file has its timeline and the recruiter's
// questions.
//
// Contract: applications.export {application_id} → {path, markdown}. path is
// `applications/<applied day>-<company>-<role>.md`. markdown carries front matter (company, role,
// applied, outcome), a Timeline (applied, then each outcome change with its note) and Their
// questions (each question and the answer; an ungrounded answer marked as a gap). One way: the
// owner's agent saves it; the instance never reads it back.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { commitApplication, setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { callTool } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

interface ExportFile { path: string; markdown: string }

const QUESTION = 'How do you handle on-call fatigue?';
const NOTE = 'Phone screen Tuesday';

let o: LoopOwner;
let app: Committed;
let visitor: APIRequestContext;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'export');
  app = await commitApplication(o, 0);
  visitor = await playwright.request.newContext();
  const sess = await issueSession(visitor, { handle: o.handle, code: app.code, visitor_name: 'Recruiter' });
  await sendMessage(visitor, sess, QUESTION);
  await callTool(o.request, o.apiToken, o.sid, 'applications.update_outcome', {
    application_id: app.applicationID, outcome: 'interview', note: NOTE,
  });
});
test.afterAll(async () => {
  await visitor.dispose();
  await o.request.dispose();
});

test('7.5.a — the exported file has the timeline and their questions', async () => {
  const f = await callTool<ExportFile>(o.request, o.apiToken, o.sid, 'applications.export', {
    application_id: app.applicationID,
  });
  expect(f.path).toMatch(/^applications\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/);
  expect(f.markdown).toContain(`company: "${app.job.company}"`);
  expect(f.markdown).toContain('outcome: interview');
  expect(f.markdown, 'the outcome change with its note').toMatch(new RegExp(`none → interview — ${NOTE}`));
  expect(f.markdown, 'their question').toContain(QUESTION);
  expect(f.markdown, 'nothing in the corpus answered it').toContain('Gap:');
});

test('7.5.a — an application that is not the owner\'s is not exported', async () => {
  const res = await callTool<ExportFile>(o.request, o.apiToken, o.sid, 'applications.export', {
    application_id: '00000000-0000-0000-0000-000000000000',
  }).then(() => 'exported', (e: unknown) => String(e));
  expect(res).toMatch(/not found/i);
});
