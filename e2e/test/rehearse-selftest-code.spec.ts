// rehearse-selftest-code.spec.ts —— roadmap 2.4.a: I rehearse before a recruiter comes.
//
// "Done" (roadmap): a rehearsal on a selftest code reports ungrounded answers and does not mark
// any application opened.
//
// Contract (workflow.guide interview-prep, "Rehearse"): the owner's AI creates a code labelled
// "selftest" and asks the posting's questions on it. The rehearsal is read back with
// conversations.list / conversations.get: an answer that cites no entry did not ground. The
// application's own code is untouched, so the application reads not opened, no questions.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  applicationRow, commitApplication, setupLoopOwner, type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { callTool } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const CODE = 'SELFTEST-RHS';
const QUESTION = 'Walk me through a production incident you led.';

interface Message { role: string; body: string; cited_wiki_ids: string[] }
interface Conversation { id: string; code_id?: string; messages?: Message[] }

let o: LoopOwner;
let app: Committed;
let visitor: APIRequestContext;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'rehearse');
  app = await commitApplication(o, 0);
  await callTool(o.request, o.apiToken, o.sid, 'codes.create', {
    code: CODE, label: 'selftest', max_turns_per_session: 20, max_members: 1,
  });
  visitor = await playwright.request.newContext();
  const sess = await issueSession(visitor, { handle: o.handle, code: CODE, visitor_name: 'Owner rehearsing' });
  await sendMessage(visitor, sess, QUESTION);
});
test.afterAll(async () => {
  await visitor.dispose();
  await o.request.dispose();
});

test('2.4.a — the rehearsal is read back, and the ungrounded answer shows as citing nothing', async () => {
  const list = await callTool<{ items: Conversation[] }>(o.request, o.apiToken, o.sid, 'conversations.list', {});
  expect(list.items.length, 'presence: the rehearsal conversation exists').toBeGreaterThan(0);
  const conv = await callTool<Conversation>(o.request, o.apiToken, o.sid, 'conversations.get',
    { conversation_id: list.items[0]!.id });
  const answer = (conv.messages ?? []).find((m) => m.role === 'assistant');
  expect(answer, 'the agent answered').toBeDefined();
  expect(answer!.cited_wiki_ids, 'nothing in the corpus behind it: a gap').toEqual([]);
});

test('2.4.a — the rehearsal does not mark the application opened', async () => {
  const row = await applicationRow(o, app.applicationID);
  expect(row.opened_at).toBeNull();
  expect(row.questions).toBe(0);
});
